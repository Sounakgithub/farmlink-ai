const LedgerEntry = require("../models/LedgerEntry");
const LogisticsProvider = require("../models/LogisticsProvider");
const { audit } = require("./audit");
const { getSettings } = require("./settings");
const { toPaise, fromPaise } = require("./fees");

/**
 * Escrow.
 *
 * The buyer's money sits between the two sides until the trade is proven:
 *
 *   placed (prepaid)   capture -> held
 *   placed (COD)       awaiting_payment -> captured on delivery -> held
 *   placed (invoice)   invoiced -> captured when the invoice is paid -> held
 *   rejected/cancelled refunded (if money was taken) or voided
 *   delivered          held, with an auto-release deadline
 *   buyer confirms     released: farmer, carrier and platform are paid
 *   buyer disputes     disputed, until an admin decides who carries the loss
 *
 * Every money movement writes a LedgerEntry in integer paise, and
 * ledgerBalance() proves an order's books close to zero.
 *
 * No real payment gateway is wired in - there are no gateway credentials in
 * this project. Movements are recorded against the "mock" rail (or "cod" /
 * "invoice"), and a gateway adapter only has to supply a gatewayRef.
 */

const PREPAID = ["UPI", "Card", "Net Banking"];

function grandTotalPaise(order) {
  return toPaise(order.charges?.grandTotal ?? order.totalAmount);
}

async function writeLedger(order, rows, req) {
  const docs = rows
    .filter((row) => row.amountPaise > 0)
    .map((row) => ({
      orderId: order._id,
      currency: "INR",
      gateway: row.gateway || "mock",
      createdBy: req?.user?._id || null,
      ...row,
    }));
  if (docs.length) await LedgerEntry.insertMany(docs);
  return docs;
}

function mark(order, status, extra = {}) {
  order.settlement = {
    ...(order.settlement?.toObject ? order.settlement.toObject() : order.settlement || {}),
    status,
    ...extra,
  };
}

/** Called once, right after an order is created. Saves the order. */
async function onOrderPlaced(order, req) {
  if (order.paymentMethod === "Invoice") {
    mark(order, "invoiced");
    await writeLedger(
      order,
      [
        {
          type: "invoice",
          party: "buyer",
          partyId: order.buyerId,
          amountPaise: grandTotalPaise(order),
          gateway: "invoice",
          memo: `Invoice ${order.invoice?.number || ""} issued`.trim(),
        },
      ],
      req
    );
  } else if (PREPAID.includes(order.paymentMethod)) {
    mark(order, "held", { heldAt: new Date() });
    await writeLedger(
      order,
      [
        {
          type: "capture",
          party: "buyer",
          partyId: order.buyerId,
          amountPaise: grandTotalPaise(order),
          memo: `${order.paymentMethod} payment captured into escrow`,
        },
      ],
      req
    );
  } else {
    mark(order, "awaiting_payment");
  }

  await order.save();
  await audit(req, "settlement.opened", "Order", order._id, {
    status: order.settlement.status,
    grandTotal: order.charges?.grandTotal,
  });
}

/**
 * The order ended before delivery (farmer rejected, buyer cancelled, failed
 * pickup inspection). Mutates the order; the caller saves it.
 */
async function onOrderVoided(order, req, reason) {
  const status = order.settlement?.status;

  if (status === "held") {
    await writeLedger(
      order,
      [
        {
          type: "refund",
          party: "buyer",
          partyId: order.buyerId,
          amountPaise: grandTotalPaise(order),
          memo: `Full refund: ${reason}`,
        },
      ],
      req
    );
    mark(order, "refunded", { refundedAt: new Date() });
  } else if (["awaiting_payment", "invoiced"].includes(status)) {
    mark(order, "voided");
  }

  await audit(req, "settlement.voided", "Order", order._id, { from: status, reason });
}

/**
 * The goods reached the buyer. Cash on delivery is collected now; the release
 * clock starts. Mutates the order; the caller saves it.
 */
async function onDelivered(order, req) {
  const settings = await getSettings();
  const autoReleaseAt = new Date(Date.now() + settings.escrow.autoReleaseHours * 3600e3);

  if (order.settlement?.status === "awaiting_payment") {
    await writeLedger(
      order,
      [
        {
          type: "capture",
          party: "buyer",
          partyId: order.buyerId,
          amountPaise: grandTotalPaise(order),
          gateway: "cod",
          memo: "Cash collected on delivery, held in escrow",
        },
      ],
      req
    );
    mark(order, "held", { heldAt: new Date(), autoReleaseAt });
  } else if (order.settlement?.status === "held") {
    mark(order, "held", { autoReleaseAt });
  } else if (order.settlement?.status === "invoiced") {
    // Credit terms: nothing moves until the invoice is paid.
    mark(order, "invoiced", { autoReleaseAt });
  }

  await audit(req, "settlement.delivered", "Order", order._id, {
    status: order.settlement?.status,
    autoReleaseAt,
  });
}

/** A wholesale invoice was paid. Mutates the order; the caller saves it. */
async function onInvoicePaid(order, req, gatewayRef = "") {
  if (order.settlement?.status !== "invoiced") {
    const error = new Error(`This invoice cannot be paid (settlement is ${order.settlement?.status}).`);
    error.status = 409;
    throw error;
  }

  await writeLedger(
    order,
    [
      {
        type: "capture",
        party: "buyer",
        partyId: order.buyerId,
        amountPaise: grandTotalPaise(order),
        gateway: "mock",
        gatewayRef,
        memo: `Invoice ${order.invoice?.number || ""} paid`.trim(),
      },
    ],
    req
  );

  order.paymentStatus = "Paid";
  if (order.invoice) order.invoice.paidAt = new Date();
  mark(order, "held", {
    heldAt: new Date(),
    autoReleaseAt: order.settlement?.autoReleaseAt,
  });

  await audit(req, "settlement.invoice_paid", "Order", order._id, {
    invoice: order.invoice?.number,
  });
}

/** Who receives the carrier's share: the company owner, or the driver. */
async function carrierPartyId(order) {
  if (order.logistics?.mode === "provider" && order.logistics.providerId) {
    const provider = await LogisticsProvider.findById(order.logistics.providerId).select("ownerId");
    if (provider) return provider.ownerId;
  }
  return order.driverId || null;
}

/**
 * Split the held funds.
 *
 * `deductions` (paise) move part of what a party would have received back to
 * the buyer as a refund - that is how a dispute decision is applied. Without
 * deductions this is a clean release. Mutates the order; the caller saves it.
 */
async function distribute(order, req, { deductions = null, memo = "" } = {}) {
  const charges = order.charges || {};
  const heldP = grandTotalPaise(order);

  // Per-farmer goods and commission, recomputed from the order lines so a
  // multi-farmer order pays each farmer their own share.
  const commissionRate = (charges.commissionPct || 0) / 100;
  const perFarmer = new Map();
  for (const line of order.products) {
    const key = String(line.farmerId);
    perFarmer.set(key, (perFarmer.get(key) || 0) + toPaise(line.totalPrice));
  }

  const farmerRows = [];
  let farmerPayoutP = 0;
  let commissionP = 0;
  for (const [farmerId, goodsP] of perFarmer) {
    const cut = Math.round(goodsP * commissionRate);
    farmerRows.push({ farmerId, payoutP: goodsP - cut });
    farmerPayoutP += goodsP - cut;
    commissionP += cut;
  }

  let carrierP = toPaise(charges.logisticsPayout || 0);
  let platformP = heldP - farmerPayoutP - carrierP;

  // A carrier payout larger than what was collected would make the platform
  // share negative; never let that happen silently.
  if (platformP < 0) {
    carrierP += platformP;
    platformP = 0;
  }

  let refundP = 0;
  const adjustments = [];

  if (deductions) {
    // Farmers' deduction is shared pro rata across their payouts.
    if (deductions.farmer > 0 && farmerPayoutP > 0) {
      const take = Math.min(deductions.farmer, farmerPayoutP);
      let remaining = take;
      farmerRows.forEach((row, index) => {
        const share =
          index === farmerRows.length - 1
            ? remaining
            : Math.round((take * row.payoutP) / farmerPayoutP);
        const applied = Math.min(share, row.payoutP, remaining);
        row.payoutP -= applied;
        remaining -= applied;
      });
      farmerPayoutP -= take;
      refundP += take;
      adjustments.push({ party: "farmer", amountPaise: take });
    }
    if (deductions.logistics > 0 && carrierP > 0) {
      const take = Math.min(deductions.logistics, carrierP);
      carrierP -= take;
      refundP += take;
      adjustments.push({ party: "logistics", amountPaise: take });
    }
    if (deductions.platform > 0 && platformP > 0) {
      const take = Math.min(deductions.platform, platformP);
      platformP -= take;
      refundP += take;
      adjustments.push({ party: "platform", amountPaise: take });
    }
  }

  const carrierId = await carrierPartyId(order);

  const rows = [
    ...farmerRows.map((row) => ({
      type: "payout",
      party: "farmer",
      partyId: row.farmerId,
      amountPaise: row.payoutP,
      memo: `Farmer payout${memo ? ` (${memo})` : ""}`,
    })),
    {
      type: "payout",
      party: "logistics",
      partyId: carrierId,
      amountPaise: carrierP,
      memo: `Carrier payout${memo ? ` (${memo})` : ""}`,
    },
    {
      type: "platform_fee",
      party: "platform",
      partyId: null,
      amountPaise: platformP,
      memo: `Commission ${charges.commissionPct || 0}% + logistics markup`,
    },
    {
      type: "refund",
      party: "buyer",
      partyId: order.buyerId,
      amountPaise: refundP,
      memo: memo ? `Refund: ${memo}` : "Refund",
    },
    ...adjustments.map((adj) => ({
      type: "adjustment",
      party: adj.party,
      partyId:
        adj.party === "logistics" ? carrierId : adj.party === "farmer" ? null : null,
      amountPaise: adj.amountPaise,
      memo: `Funded ₹${fromPaise(adj.amountPaise)} of the buyer refund`,
    })),
  ];

  // The books must close: what was held is exactly what goes out.
  const outP = farmerRows.reduce((s, r) => s + r.payoutP, 0) + carrierP + platformP + refundP;
  if (outP !== heldP) {
    throw new Error(`Settlement does not balance: held ${heldP}p, distributing ${outP}p.`);
  }

  await writeLedger(order, rows, req);

  return {
    heldPaise: heldP,
    farmerPayoutPaise: farmerPayoutP,
    carrierPayoutPaise: carrierP,
    platformPaise: platformP,
    refundPaise: refundP,
    commissionPaise: commissionP,
  };
}

/** Pay everyone. Mutates the order; the caller saves it. */
async function release(order, req, reason = "buyer confirmed good condition") {
  if (order.settlement?.status !== "held") {
    const error = new Error(`Funds cannot be released from "${order.settlement?.status}".`);
    error.status = 409;
    throw error;
  }

  const split = await distribute(order, req);
  mark(order, "released", { releasedAt: new Date() });

  await audit(req, "settlement.released", "Order", order._id, {
    reason,
    farmerPayout: fromPaise(split.farmerPayoutPaise),
    carrierPayout: fromPaise(split.carrierPayoutPaise),
    platformRevenue: fromPaise(split.platformPaise),
  });

  return split;
}

/** Freeze funds pending an admin decision. Mutates the order. */
async function openDispute(order, req, details = {}) {
  const from = order.settlement?.status;
  if (!["held", "invoiced", "awaiting_payment"].includes(from)) return;
  mark(order, "disputed", { disputedAt: new Date() });
  await audit(req, "settlement.disputed", "Order", order._id, { from, ...details });
}

/**
 * Decide a dispute.
 *
 * refundPct is a share of what the buyer paid (goods and delivery), so a
 * 100% decision really does make the buyer whole. Liability decides who
 * funds it:
 *   farmer     from the farmer's payout
 *   logistics  from the carrier's payout
 *   shared     half each
 *   none       the platform refunds as goodwill
 *
 * The buyer always receives the full decided refund. It is funded in order:
 * the liable party's payout on this order, then the platform's share of it,
 * and finally - when even that is not enough, as with a carrier that damaged
 * a whole load worth far more than its delivery fee - by the platform
 * advancing its own funds. That advance is recorded, and the part a carrier
 * owes beyond its payout, up to the liability cover it published, is recorded
 * as a claim against it so the platform can recover it.
 */
async function resolveDispute(order, req, { liability, refundPct, notes = "" }) {
  if (order.settlement?.status !== "disputed") {
    const error = new Error("Only a disputed order can be resolved.");
    error.status = 409;
    throw error;
  }
  if (!["farmer", "logistics", "shared", "none"].includes(liability)) {
    const error = new Error("Liability must be farmer, logistics, shared or none.");
    error.status = 400;
    throw error;
  }
  const pct = Number(refundPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    const error = new Error("Refund must be between 0 and 100 percent of what the buyer paid.");
    error.status = 400;
    throw error;
  }

  // A disputed invoice that was never paid has nothing to distribute.
  const wasInvoiced = order.paymentStatus === "Invoiced";

  const goodsP = toPaise(order.charges?.goods ?? order.totalAmount);
  const refundTargetP = Math.round((grandTotalPaise(order) * pct) / 100);

  let deductions = { farmer: 0, logistics: 0, platform: 0 };
  if (liability === "farmer") deductions.farmer = refundTargetP;
  if (liability === "logistics") deductions.logistics = refundTargetP;
  if (liability === "shared") {
    deductions.farmer = Math.floor(refundTargetP / 2);
    deductions.logistics = refundTargetP - deductions.farmer;
  }
  if (liability === "none") deductions.platform = refundTargetP;

  let split = null;
  let claimP = 0;

  if (!wasInvoiced) {
    // What the liable parties can fund from this order's own payouts.
    const probe = await probeCapacity(order);
    const shortfall = Math.max(0, deductions.farmer - probe.farmer) +
      Math.max(0, deductions.logistics - probe.logistics);
    deductions.platform += shortfall;

    // Carrier liability beyond its payout becomes a claim, within its cover.
    if (liability === "logistics" || liability === "shared") {
      const owedP = liability === "logistics" ? refundTargetP : refundTargetP - Math.floor(refundTargetP / 2);
      const beyondP = Math.max(0, owedP - probe.logistics);
      const cover = order.logistics?.liability;
      if (beyondP > 0 && cover) {
        const capP = Math.min(
          Math.round((goodsP * (cover.coveragePct || 0)) / 100),
          toPaise(cover.maxPerOrder || 0)
        );
        claimP = Math.min(beyondP, capP);
      }
    }

    split = await distribute(order, req, { deductions, memo: `dispute: ${liability} liable` });

    // Whatever the held funds could not cover, the platform fronts.
    const gapP = Math.max(0, refundTargetP - split.refundPaise);
    if (gapP > 0) {
      await writeLedger(
        order,
        [
          {
            type: "advance",
            party: "platform",
            partyId: null,
            amountPaise: gapP,
            gateway: "treasury",
            memo: "Platform advanced funds so the buyer receives the full decided refund",
          },
          {
            type: "refund",
            party: "buyer",
            partyId: order.buyerId,
            amountPaise: gapP,
            gateway: "treasury",
            memo: "Refund fronted by FarmLink",
          },
        ],
        req
      );
      split.refundPaise += gapP;
      split.advancePaise = gapP;
    }

    if (claimP > 0) {
      await writeLedger(
        order,
        [
          {
            type: "adjustment",
            party: "logistics",
            partyId: await carrierPartyId(order),
            amountPaise: claimP,
            memo: `Damage claim receivable from carrier (within its published liability cover)`,
          },
        ],
        req
      );
      if (order.logistics?.providerId) {
        await LogisticsProvider.updateOne(
          { _id: order.logistics.providerId },
          { $inc: { "stats.damageClaims": 1 } }
        );
      }
    }
  }

  const refundAmount = split ? fromPaise(split.refundPaise) : 0;
  const resolution = {
    liability,
    refundPct: pct,
    refundAmount,
    notes: String(notes || "").slice(0, 1000),
    decidedBy: req?.user?._id,
    decidedAt: new Date(),
  };

  const finalStatus = wasInvoiced
    ? "voided"
    : split.refundPaise === 0
      ? "released"
      : split.refundPaise >= grandTotalPaise(order)
        ? "refunded"
        : "partially_refunded";

  mark(order, finalStatus, {
    resolution,
    releasedAt: new Date(),
    ...(split?.refundPaise ? { refundedAt: new Date() } : {}),
  });

  order.inspection = {
    ...(order.inspection?.toObject ? order.inspection.toObject() : order.inspection || {}),
    liability,
    liabilityReason: `Decided by admin: ${notes || liability}`,
  };

  await audit(req, "settlement.dispute_resolved", "Order", order._id, {
    ...resolution,
    claimAgainstCarrier: fromPaise(claimP),
  });

  return { resolution, split, claimAgainstCarrier: fromPaise(claimP) };
}

/** How much the farmer and carrier could fund from this order's payouts. */
async function probeCapacity(order) {
  const charges = order.charges || {};
  const commissionRate = (charges.commissionPct || 0) / 100;
  let farmer = 0;
  for (const line of order.products) {
    const goodsP = toPaise(line.totalPrice);
    farmer += goodsP - Math.round(goodsP * commissionRate);
  }
  const heldP = grandTotalPaise(order);
  let logistics = toPaise(charges.logisticsPayout || 0);
  if (heldP - farmer - logistics < 0) logistics = heldP - farmer;
  return { farmer, logistics: Math.max(0, logistics) };
}

/**
 * Prove an order's books close.
 * @returns {{captured, refunded, paidOut, platform, stillHeld}} in paise
 */
async function ledgerBalance(orderId) {
  const rows = await LedgerEntry.find({ orderId }).lean();
  const sum = (type) =>
    rows.filter((r) => r.type === type).reduce((total, r) => total + r.amountPaise, 0);
  const captured = sum("capture");
  const advanced = sum("advance");
  const refunded = sum("refund");
  const paidOut = sum("payout");
  const platform = sum("platform_fee");
  return {
    captured,
    advanced,
    refunded,
    paidOut,
    platform,
    // Money in (buyer + platform advances) minus money out. Zero once closed.
    stillHeld: captured + advanced - refunded - paidOut - platform,
    rows: rows.length,
  };
}

/**
 * Release funds whose window lapsed without the buyer confirming or
 * disputing. Run on a timer by the server.
 */
async function sweepAutoRelease() {
  const Order = require("../models/Order");
  const due = await Order.find({
    status: "Delivered",
    "settlement.status": "held",
    "settlement.autoReleaseAt": { $lte: new Date() },
    "inspection.delivery.result": { $ne: "disputed" },
  }).limit(100);

  let released = 0;
  for (const order of due) {
    try {
      await release(order, null, "release window lapsed without a dispute");
      await order.save();
      released += 1;
    } catch (error) {
      console.error(`AUTO-RELEASE FAILED for ${order._id}:`, error.message);
    }
  }
  return released;
}

module.exports = {
  onOrderPlaced,
  onOrderVoided,
  onDelivered,
  onInvoicePaid,
  release,
  openDispute,
  resolveDispute,
  ledgerBalance,
  sweepAutoRelease,
  PREPAID,
};
