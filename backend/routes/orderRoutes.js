const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const { protect, requireRole } = require("../middleware/auth");
const {
  geocode,
  approxNear,
  hashSeed,
  DEFAULT_DEPOT,
} = require("../utils/geocode");
const { haversineKm } = require("../utils/routeOptimizer");
const { driverCard } = require("../utils/driverAssignment");
const Inspection = require("../models/Inspection");
const LedgerEntry = require("../models/LedgerEntry");
const LogisticsProvider = require("../models/LogisticsProvider");
const { priceCart, storedLines, storedCharges } = require("../utils/orderPricing");
const settlement = require("../utils/settlement");
const { dispatch } = require("../utils/logistics");
const { recordPickupInspection } = require("../utils/inspection");
const { getSettings } = require("../utils/settings");
const { roadRoute } = require("../utils/roadRouting");
const { audit } = require("../utils/audit");

const router = express.Router();

const ACTIVE_STATUSES = ["Pending", "Accepted", "Confirmed", "In Transit"];
const PAYMENT_METHODS = Order.PAYMENT_METHODS;
const PREPAID = ["UPI", "Card", "Net Banking"];

// Who is allowed to move an order from X to Y.
const TRANSITIONS = {
  farmer: {
    Pending: ["Accepted", "Rejected"],
  },
  driver: {
    Accepted: ["In Transit"],
    Confirmed: ["In Transit"],
    "In Transit": ["Delivered"],
  },
  buyer: {
    Pending: ["Cancelled"],
    Accepted: ["Cancelled"],
    Confirmed: ["Cancelled"],
  },
};

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Human-friendly order reference, matching the one the UI shows.
const shortId = (id) => `#${String(id).slice(-6).toUpperCase()}`;

// Restrict a query to what this role is allowed to see.
function scopeForUser(user) {
  if (user.role === "buyer") return { buyerId: user._id };
  if (user.role === "farmer") return { "products.farmerId": user._id };
  // A carrier company works from its offers (/api/logistics/assignments),
  // never the raw order list with buyers' contact details.
  if (user.role === "logistics") return { _id: { $in: [] } };
  return {}; // driver sees the delivery pool; admin sees everything
}

/**
 * Each party sees the money that concerns them, and nothing else.
 *
 *   buyer    what they pay: goods, delivery fee (carrier rate + markup), total
 *   farmer   their own lines, commission and payout - never another farmer's
 *   driver   what to collect on delivery, and what the job pays
 *   admin    everything
 */
function projectCharges(plain, user, myLines) {
  const c = plain.charges;
  // Orders from before fees existed carry no breakdown worth showing.
  if (!c || !c.grandTotal) return undefined;

  if (user.role === "admin") return c;

  if (user.role === "buyer") {
    return {
      goods: c.goods,
      deliveryFee: c.deliveryFee,
      grandTotal: c.grandTotal,
      feeTier: c.feeTier,
      carrierRate: c.logisticsPayout,
      logisticsMarkup: c.logisticsMarkup,
      logisticsMarkupPct: c.logisticsMarkupPct,
      quote: c.quote,
    };
  }

  if (user.role === "farmer") {
    const goods = myLines.reduce((sum, l) => sum + l.totalPrice, 0);
    const commission = Math.round(goods * (c.commissionPct || 0)) / 100;
    return {
      goods,
      commissionPct: c.commissionPct,
      commission,
      payout: Math.round((goods - commission) * 100) / 100,
    };
  }

  // driver / logistics
  return {
    grandTotal: c.grandTotal,
    deliveryPayout: c.logisticsPayout,
    quote: c.quote,
  };
}

// A farmer must only ever see their own lines / totals within a shared order.
function projectForUser(order, user) {
  const plain = order.toObject ? order.toObject() : order;

  if (user.role !== "farmer") {
    return { ...plain, charges: projectCharges(plain, user, plain.products) };
  }

  const myLines = plain.products.filter(
    (line) => String(line.farmerId) === String(user._id)
  );

  return {
    ...plain,
    products: myLines,
    totalAmount: myLines.reduce((sum, l) => sum + l.totalPrice, 0),
    fullOrderAmount: plain.totalAmount,
    charges: projectCharges(plain, user, myLines),
  };
}

async function restoreStock(order) {
  await Promise.all(
    order.products.map((line) =>
      Product.updateOne(
        { _id: line.productId },
        { $inc: { quantity: line.quantity } }
      )
    )
  );
}

// Attach the assigned delivery partner so the buyer knows who is bringing
// their order and how to reach them.
//
// Two bulk queries for the whole page, never one per order. Name, phone and
// city only - the email and everything else on the account stay private.
async function withDriver(orders) {
  const driverIds = [
    ...new Set(orders.filter((o) => o.driverId).map((o) => String(o.driverId))),
  ];
  if (driverIds.length === 0) return orders;

  const [drivers, completedCounts] = await Promise.all([
    User.find({ _id: { $in: driverIds } }).select("name phone location createdAt"),
    Order.aggregate([
      { $match: { driverId: { $in: driverIds.map((id) => new mongoose.Types.ObjectId(id)) }, status: "Delivered" } },
      { $group: { _id: "$driverId", count: { $sum: 1 } } },
    ]),
  ]);

  const byId = new Map(drivers.map((d) => [String(d._id), d]));
  const completedById = new Map(
    completedCounts.map((row) => [String(row._id), row.count])
  );

  return orders.map((order) => {
    if (!order.driverId) return order;
    const driver = byId.get(String(order.driverId));
    return {
      ...order,
      driver: driver
        ? {
            id: driver._id,
            name: driver.name,
            phone: driver.phone || "",
            location: driver.location || "",
            completedDeliveries: completedById.get(String(driver._id)) || 0,
            partnerSince: driver.createdAt,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// POST /api/orders/quote  -  checkout preview
// What this cart will cost, delivered: tier prices, road distance, the delivery
// options and the fee breakdown. Creates nothing and reserves no stock.
// ---------------------------------------------------------------------------
router.post("/quote", protect, requireRole("buyer"), async (req, res) => {
  try {
    const { items, deliveryAddress } = req.body || {};
    const priced = await priceCart({ items, buyer: req.user, deliveryAddress });
    res.json(quoteResponse(priced, req.user));
  } catch (error) {
    if (!error.status) console.error("ORDER QUOTE ERROR:", error);
    res.status(error.status || 500).json({ message: error.message });
  }
});

/** The shape of a checkout preview, shared with the wholesale quote. */
function quoteResponse(priced, user) {
  const markup = priced.fees.logisticsMarkupPct / 100;
  return {
    lines: priced.lines,
    charges: projectCharges({ charges: storedCharges(priced.charges) }, user, priced.lines),
    delivery: priced.quote
      ? {
          distanceKm: priced.quote.route.distanceKm,
          durationMin: priced.quote.route.durationMin,
          routeSource: priced.quote.route.source,
          approximate: priced.quote.route.approximate,
          geometry: priced.quote.route.geometry,
          chosen: priced.charges.quote,
          options: priced.quote.options.map((o) => ({
            carrier: o.carrier,
            providerName: o.providerName,
            deliveryFee: Math.round(o.providerFee * (1 + markup) * 100) / 100,
            liability: o.liability,
            refrigerated: o.refrigerated,
          })),
        }
      : null,
    fees: {
      tier: priced.fees.tier,
      logisticsMarkupPct: priced.fees.logisticsMarkupPct,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /api/orders  -  buyer places an order
// Prices, totals and the farmer for each line are read from the database,
// never trusted from the request body.
// ---------------------------------------------------------------------------
router.post("/", protect, requireRole("buyer"), async (req, res) => {
  try {
    const { items, deliveryAddress, deliveryInstructions, paymentMethod } =
      req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Your cart is empty." });
    }

    const method = paymentMethod || "Cash on Delivery";
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ message: "Choose a valid payment method." });
    }

    const address = deliveryAddress || req.user.location || "";
    const order = await placeOrder({
      req,
      items,
      address,
      deliveryInstructions,
      method,
      channel: req.apiKey ? "api" : "b2c",
    });

    res.status(201).json({
      message: "Order placed successfully",
      order: projectForUser(order, req.user),
    });
  } catch (error) {
    if (!error.status) console.error("CREATE ORDER ERROR:", error);
    res.status(error.status || 400).json({ message: error.message });
  }
});

/**
 * Create a priced order, reserve its stock and open escrow.
 * Shared by the retail checkout, the wholesale flow and the partner API.
 */
async function placeOrder({
  req,
  items,
  address,
  deliveryInstructions,
  method,
  channel,
  minLineKg = 0,
  invoice,
}) {
  const priced = await priceCart({
    items,
    buyer: req.user,
    deliveryAddress: address,
    minLineKg,
  });

  const lines = storedLines(priced.lines);
  const totalAmount =
    Math.round(lines.reduce((sum, l) => sum + l.totalPrice, 0) * 100) / 100;

  let paymentStatus = PREPAID.includes(method) ? "Paid" : "Pending";
  if (method === "Invoice") paymentStatus = "Invoiced";

  const order = await Order.create({
    buyerId: req.user._id,
    buyerName: req.user.name,
    buyerEmail: req.user.email,
    deliveryAddress: address,
    deliveryInstructions: String(deliveryInstructions || "").trim().slice(0, 500),
    paymentMethod: method,
    paymentStatus,
    products: lines,
    totalAmount,
    charges: storedCharges(priced.charges),
    channel,
    invoice,
    status: "Pending",
    statusHistory: [{ status: "Pending", by: req.user.name }],
  });

  // Reserve the stock now that the order exists.
  await Promise.all(
    priced.stockUpdates.map((u) =>
      Product.updateOne({ _id: u.id }, { $inc: { quantity: -u.quantity } })
    )
  );

  await settlement.onOrderPlaced(order, req);
  await audit(req, "order.placed", "Order", order._id, {
    channel,
    totalAmount,
    grandTotal: order.charges.grandTotal,
    paymentMethod: method,
    lines: lines.length,
  });

  return order;
}

// ---------------------------------------------------------------------------
// GET /api/orders  -  role-scoped list
// ---------------------------------------------------------------------------
router.get("/", protect, async (req, res) => {
  try {
    const filter = { ...scopeForUser(req.user) };

    if (req.query.status) {
      filter.status = req.query.status;
    } else if (req.query.active === "true") {
      filter.status = { $in: ACTIVE_STATUSES };
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });

    const projected = orders.map((order) => projectForUser(order, req.user));
    res.json(await withDriver(projected));
  } catch (error) {
    console.error("GET ORDERS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/stats  -  role-aware headline numbers
// ---------------------------------------------------------------------------
router.get("/stats", protect, async (req, res) => {
  try {
    const orders = await Order.find(scopeForUser(req.user));

    const amountFor = (order) => {
      if (req.user.role !== "farmer") return order.totalAmount;
      return order.products
        .filter((l) => String(l.farmerId) === String(req.user._id))
        .reduce((sum, l) => sum + l.totalPrice, 0);
    };

    const stats = {
      total: orders.length,
      pending: 0,
      active: 0,
      delivered: 0,
      cancelled: 0,
      totalValue: 0,
      completedValue: 0,
    };

    for (const order of orders) {
      const value = amountFor(order);
      stats.totalValue += value;

      if (order.status === "Pending") stats.pending += 1;
      if (ACTIVE_STATUSES.includes(order.status)) stats.active += 1;
      if (order.status === "Delivered") {
        stats.delivered += 1;
        stats.completedValue += value;
      }
      if (["Cancelled", "Rejected"].includes(order.status)) stats.cancelled += 1;
    }

    res.json(stats);
  } catch (error) {
    console.error("ORDER STATS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------
router.get("/:id", protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      ...scopeForUser(req.user),
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const [projected] = await withDriver([projectForUser(order, req.user)]);
    res.json(projected);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/instructions  -  buyer updates delivery notes
// ---------------------------------------------------------------------------
router.patch("/:id/instructions", protect, requireRole("buyer"), async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (["Delivered", "Cancelled", "Rejected"].includes(order.status)) {
      return res.status(400).json({
        message: "This order is closed — delivery notes can no longer change.",
      });
    }

    order.deliveryInstructions = String(req.body.deliveryInstructions || "")
      .trim()
      .slice(0, 500);
    const updated = await order.save();

    res.json({
      message: "Delivery instructions saved",
      order: projectForUser(updated, req.user),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status  -  guarded state machine
// ---------------------------------------------------------------------------
router.patch("/:id/status", protect, async (req, res) => {
  try {
    const { status } = req.body;

    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      ...scopeForUser(req.user),
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const allowed = (TRANSITIONS[req.user.role] || {})[order.status] || [];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `A ${req.user.role} cannot change an order from "${order.status}" to "${status}".`,
        allowedNext: allowed,
      });
    }

    const from = order.status;

    // ---- leaving the farm -------------------------------------------------
    if (status === "In Transit" && req.user.role === "driver") {
      // A job offered to, or taken by, a logistics company is theirs to run.
      if (["offered", "provider"].includes(order.logistics?.mode)) {
        const mine =
          String(order.driverId) === String(req.user._id) ||
          (req.user.providerId &&
            String(req.user.providerId) === String(order.logistics.providerId) &&
            order.logistics.mode === "provider");
        if (!mine) {
          return res.status(403).json({
            message:
              order.logistics.mode === "offered"
                ? `This delivery is waiting on ${order.logistics.providerName} to accept it.`
                : `This delivery is assigned to ${order.logistics.providerName}.`,
          });
        }
      }

      const settings = await getSettings();
      if (settings.inspection.requirePickupInspection && order.inspection?.pickup?.result !== "passed") {
        if (!req.body.inspection) {
          return res.status(409).json({
            message: "A passed pickup quality inspection is required before the goods leave the farm.",
            code: "PICKUP_INSPECTION_REQUIRED",
          });
        }

        // The driver can inspect and collect in one step.
        const { verdict } = await recordPickupInspection(order, req, req.body.inspection);
        if (verdict.result === "failed") {
          return res.status(409).json({
            message: "The goods failed pickup inspection. The order has been rejected and the buyer refunded.",
            code: "PICKUP_INSPECTION_FAILED",
            reasons: verdict.reasons,
            order: projectForUser(order, req.user),
          });
        }
      }

      // The pool stays open: whoever actually collects the order owns it.
      order.driverId = req.user._id;
    }

    // ---- ended early ------------------------------------------------------
    if (["Rejected", "Cancelled"].includes(status)) {
      await restoreStock(order);
      if (order.paymentStatus === "Paid") order.paymentStatus = "Refunded";
      await settlement.onOrderVoided(order, req, `order ${status.toLowerCase()} by ${req.user.role}`);
    }

    order.status = status;
    order.statusHistory.push({ status, by: req.user.name });

    // ---- accepted: find it a carrier ---------------------------------------
    if (["Accepted", "Confirmed"].includes(status) && !order.driverId) {
      try {
        await dispatch(order, req);
      } catch (dispatchError) {
        // Never block a farmer accepting an order; the first driver to
        // collect it will claim it instead.
        console.error("DISPATCH FAILED:", dispatchError.message);
      }
    }

    // ---- delivered --------------------------------------------------------
    if (status === "Delivered") {
      // Cash is collected on delivery.
      if (order.paymentStatus === "Pending") order.paymentStatus = "Paid";
      await settlement.onDelivered(order, req);
      if (order.logistics?.mode === "provider" && order.logistics.providerId) {
        await LogisticsProvider.updateOne(
          { _id: order.logistics.providerId },
          { $inc: { "stats.delivered": 1 } }
        );
      }
    }

    const updated = await order.save();

    await audit(req, "order.status", "Order", order._id, { from, to: status });

    res.json({
      message: `Order marked as ${status}`,
      order: projectForUser(updated, req.user),
    });
  } catch (error) {
    if (!error.status) console.error("UPDATE STATUS ERROR:", error);
    res.status(error.status || 500).json({
      message: error.message,
      ...(error.problems ? { problems: error.problems } : {}),
    });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/cancel  -  buyer shortcut
// ---------------------------------------------------------------------------
router.patch("/:id/cancel", protect, requireRole("buyer"), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.status === "Delivered") {
      return res.status(400).json({
        message: "A delivered order cannot be cancelled.",
      });
    }

    if (["Cancelled", "Rejected"].includes(order.status)) {
      return res.status(400).json({ message: "This order is already closed." });
    }

    if (order.status === "In Transit") {
      return res.status(400).json({
        message: "This order is already on its way and cannot be cancelled.",
      });
    }

    await restoreStock(order);

    const from = order.status;
    order.status = "Cancelled";
    if (order.paymentStatus === "Paid") order.paymentStatus = "Refunded";
    order.statusHistory.push({ status: "Cancelled", by: req.user.name });
    await settlement.onOrderVoided(order, req, "cancelled by buyer");

    const updated = await order.save();
    await audit(req, "order.status", "Order", order._id, { from, to: "Cancelled" });

    res.json({
      message: "Order cancelled successfully",
      order: projectForUser(updated, req.user),
    });
  } catch (error) {
    console.error("CANCEL ORDER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id/tracking
//
// The whole journey for ONE order, for the parcel-tracking view: where it is
// collected from, where it is going, where the driver is right now, and how
// far along that is.
//
// Visible to the buyer who placed it, a farmer whose crop is in it, and the
// assigned driver - nobody else.
// ---------------------------------------------------------------------------
router.get("/:id/tracking", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findById(req.params.id).populate(
      "products.productId",
      "location cropName"
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const me = req.user;
    const isBuyer = String(order.buyerId) === String(me._id);
    const isFarmer = order.products.some(
      (line) => String(line.farmerId) === String(me._id)
    );
    const isDriver = order.driverId && String(order.driverId) === String(me._id);

    if (!isBuyer && !isFarmer && !isDriver) {
      return res.status(403).json({ message: "This is not your order." });
    }

    const firstLine = order.products[0];

    // --- the two ends of the journey ---------------------------------------
    const farmPlace =
      (firstLine && firstLine.productId && firstLine.productId.location) ||
      (firstLine && firstLine.location) ||
      "";
    const farmHit = geocode(farmPlace);
    const farmPoint =
      farmHit || approxNear(DEFAULT_DEPOT, hashSeed(`${order._id}-pickup`));

    const dropPlace = order.deliveryAddress || "";
    const dropHit = geocode(dropPlace);
    const dropPoint =
      dropHit || approxNear(DEFAULT_DEPOT, hashSeed(`${order._id}-dropoff`));

    const pickup = {
      lat: farmPoint.lat,
      lng: farmPoint.lng,
      label: `${(firstLine && firstLine.cropName) || "Produce"} farm`,
      place: farmPlace || "Farm location not recorded",
      farmerName: firstLine && firstLine.farmerName,
      approxLocation: !farmHit,
    };

    // The buyer's own address is only echoed back to people already entitled
    // to it - the buyer themselves, the farmer fulfilling it, and the driver.
    const dropoff = {
      lat: dropPoint.lat,
      lng: dropPoint.lng,
      label: "Delivery address",
      place: dropPlace || "No delivery address given",
      approxLocation: !dropHit,
    };

    const totalKm = haversineKm(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: dropoff.lat, lng: dropoff.lng }
    );

    // --- where the driver is, if they are sharing it -----------------------
    let driver = null;
    let progressPct = null;
    let remainingKm = null;
    let etaMinutes = null;

    const hasPing =
      order.driverLocation &&
      Number.isFinite(order.driverLocation.latitude) &&
      Number.isFinite(order.driverLocation.longitude);

    if (hasPing) {
      const at = { lat: order.driverLocation.latitude, lng: order.driverLocation.longitude };
      const fromPickup = haversineKm({ lat: pickup.lat, lng: pickup.lng }, at);
      const toDropoff = haversineKm(at, { lat: dropoff.lat, lng: dropoff.lng });

      // Share of the journey covered. Using both legs rather than the straight
      // pickup->driver distance keeps it sane when the driver detours.
      const covered = fromPickup + toDropoff;
      progressPct =
        covered > 0 ? Math.round(Math.min(100, Math.max(0, (fromPickup / covered) * 100))) : 0;
      remainingKm = Number(toDropoff.toFixed(2));
      etaMinutes = Math.round((toDropoff / 28) * 60); // same 28km/h the planner assumes

      driver = {
        lat: at.lat,
        lng: at.lng,
        updatedAt: order.driverLocation.updatedAt,
      };
    } else {
      // No live ping yet - fall back to what the status implies.
      progressPct =
        order.status === "Delivered" ? 100 : order.status === "In Transit" ? 50 : 0;
      remainingKm = Number(totalKm.toFixed(2));
      etaMinutes = Math.round((totalKm / 28) * 60);
    }

    // --- the stages the parcel moves through -------------------------------
    const reached = (statuses) => statuses.includes(order.status);
    const stages = [
      {
        key: "placed",
        label: "Order placed",
        done: true,
        at: order.createdAt,
      },
      {
        key: "accepted",
        label: "Accepted by farmer",
        done: reached(["Accepted", "Confirmed", "In Transit", "Delivered"]),
      },
      {
        key: "picked",
        label: `Collected from ${pickup.place}`,
        done: reached(["In Transit", "Delivered"]),
      },
      {
        key: "transit",
        label: "Out for delivery",
        done: reached(["In Transit", "Delivered"]),
        current: order.status === "In Transit",
      },
      {
        key: "delivered",
        label: `Delivered to ${dropoff.place}`,
        done: order.status === "Delivered",
      },
    ];

    for (const entry of order.statusHistory || []) {
      const stage = stages.find(
        (s) =>
          (s.key === "accepted" && ["Accepted", "Confirmed"].includes(entry.status)) ||
          (s.key === "transit" && entry.status === "In Transit") ||
          (s.key === "picked" && entry.status === "In Transit") ||
          (s.key === "delivered" && entry.status === "Delivered")
      );
      if (stage && !stage.at) stage.at = entry.at;
    }

    // The real road between farm and door, when a routing provider answers.
    let road = null;
    try {
      road = await roadRoute(
        { lat: pickup.lat, lng: pickup.lng },
        { lat: dropoff.lat, lng: dropoff.lng }
      );
    } catch {
      road = null;
    }

    res.json({
      orderId: order._id,
      status: order.status,
      cancelled: ["Cancelled", "Rejected"].includes(order.status),
      road: road
        ? {
            distanceKm: road.distanceKm,
            durationMin: road.durationMin,
            geometry: road.geometry,
            source: road.source,
            approximate: road.approximate,
          }
        : null,
      logistics: order.logistics?.mode
        ? {
            mode: order.logistics.mode,
            providerName: order.logistics.providerName || null,
            liability: order.logistics.liability || null,
          }
        : null,
      inspection: {
        pickup: order.inspection?.pickup?.result ? order.inspection.pickup : null,
        delivery: order.inspection?.delivery?.result ? order.inspection.delivery : null,
      },
      // Who is bringing it, as soon as one is assigned.
      deliveryPartner: await driverCard(order.driverId),
      crop: firstLine && firstLine.cropName,
      items: order.products.map((line) => ({
        cropName: line.cropName,
        quantity: line.quantity,
        farmerName: line.farmerName,
      })),
      pickup,
      dropoff,
      driver,
      stages,
      straightLineKm: Number(totalKm.toFixed(2)),
      remainingKm,
      etaMinutes,
      progressPct,
      hasLiveLocation: !!hasPing,
      approximate: pickup.approxLocation || dropoff.approxLocation,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("ORDER TRACKING ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/location  -  driver GPS ping
// ---------------------------------------------------------------------------
router.patch("/:id/location", protect, requireRole("driver"), async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({
        message: "A numeric latitude and longitude are required.",
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    // Only the driver actually carrying this order may report its position -
    // otherwise any driver account could move the dot on someone else's
    // tracking map.
    if (!order.driverId || String(order.driverId) !== String(req.user._id)) {
      return res.status(403).json({
        message: "You are not the delivery partner for this order.",
      });
    }

    order.driverLocation = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      updatedAt: new Date(),
    };

    const updated = await order.save();

    res.json({
      message: "Driver location updated",
      driverLocation: updated.driverLocation,
    });
  } catch (error) {
    console.error("UPDATE LOCATION ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id/operations
//
// Everything that happened to one order behind the scenes: both inspections
// (with their evidence), the escrow state, the logistics assignment, and the
// ledger rows this viewer is entitled to see.
// ---------------------------------------------------------------------------
router.get("/:id/operations", protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found." });

    const me = req.user;
    const isBuyer = String(order.buyerId) === String(me._id);
    const isFarmer = order.products.some((l) => String(l.farmerId) === String(me._id));
    const isDriver = order.driverId && String(order.driverId) === String(me._id);
    let isCarrier = false;
    if (me.role === "logistics" && order.logistics?.providerId) {
      isCarrier = !!(await LogisticsProvider.exists({
        _id: order.logistics.providerId,
        ownerId: me._id,
      }));
    }
    const isAdmin = me.role === "admin";

    if (!isBuyer && !isFarmer && !isDriver && !isCarrier && !isAdmin) {
      return res.status(403).json({ message: "This is not your order." });
    }

    const [inspections, ledger] = await Promise.all([
      Inspection.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
      LedgerEntry.find({ orderId: order._id }).sort({ createdAt: 1 }).lean(),
    ]);

    // Ledger visibility: each party sees its own money movements.
    const visibleLedger = ledger.filter((row) => {
      if (isAdmin) return true;
      if (isBuyer && row.party === "buyer") return true;
      if (isFarmer && row.party === "farmer" && String(row.partyId) === String(me._id)) return true;
      if ((isDriver || isCarrier) && row.party === "logistics" && String(row.partyId) === String(me._id)) return true;
      return false;
    });

    const viewer = isAdmin
      ? "admin"
      : isBuyer
        ? "buyer"
        : isFarmer
          ? "farmer"
          : "carrier";

    const plain = projectForUser(order, { ...me.toObject(), role: viewer === "carrier" ? "driver" : viewer, _id: me._id });

    res.json({
      orderId: order._id,
      status: order.status,
      viewer,
      charges: plain.charges,
      settlement: {
        status: order.settlement?.status,
        heldAt: order.settlement?.heldAt,
        autoReleaseAt: order.settlement?.autoReleaseAt,
        releasedAt: order.settlement?.releasedAt,
        refundedAt: order.settlement?.refundedAt,
        disputedAt: order.settlement?.disputedAt,
        resolution: order.settlement?.resolution || null,
      },
      inspection: {
        liability: order.inspection?.liability || "none",
        liabilityReason: order.inspection?.liabilityReason || "",
        records: inspections.map((i) => ({
          id: i._id,
          stage: i.stage,
          result: i.result,
          grade: i.grade,
          condition: i.condition,
          checks: i.checks,
          expectedKg: i.expectedKg,
          measuredKg: i.measuredKg,
          notes: i.notes,
          photos: i.photos,
          reasons: i.reasons,
          inspectorName: i.inspectorName,
          inspectorRole: i.inspectorRole,
          at: i.createdAt,
        })),
      },
      logistics: {
        mode: order.logistics?.mode || "unassigned",
        providerName: order.logistics?.providerName || null,
        offersMade: order.logistics?.offersMade || 0,
        liability: order.logistics?.liability || null,
      },
      invoice: order.invoice || null,
      ledger: visibleLedger.map((row) => ({
        type: row.type,
        party: row.party,
        amount: row.amountPaise / 100,
        memo: row.memo,
        gateway: row.gateway,
        at: row.createdAt,
      })),
      canConfirmDelivery:
        isBuyer && order.status === "Delivered" && !order.inspection?.delivery?.result,
    });
  } catch (error) {
    console.error("ORDER OPERATIONS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
module.exports.placeOrder = placeOrder;
module.exports.projectForUser = projectForUser;
module.exports.quoteResponse = quoteResponse;
