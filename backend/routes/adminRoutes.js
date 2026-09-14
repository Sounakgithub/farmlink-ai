const express = require("express");
const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const Order = require("../models/Order");
const User = require("../models/User");
const LedgerEntry = require("../models/LedgerEntry");
const LogisticsProvider = require("../models/LogisticsProvider");
const LogisticsAssignment = require("../models/LogisticsAssignment");
const Inspection = require("../models/Inspection");
const { protect, requireRole } = require("../middleware/auth");
const { getSettings, updateSettings } = require("../utils/settings");
const settlement = require("../utils/settlement");
const { sweepExpiredOffers } = require("../utils/logistics");
const { topPairs } = require("../utils/matching/pairs");
const { audit } = require("../utils/audit");

/**
 * Platform operations. Every route here requires the admin role, which can
 * only be granted from the command line (scripts/create-admin.js).
 */

const router = express.Router();
router.use(protect, requireRole("admin"));

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const send = (res, error, label) => {
  if (!error.status) console.error(`${label}:`, error);
  res.status(error.status || 500).json({ message: error.message });
};
const rupees = (paise) => Math.round(paise) / 100;

// ---------------------------------------------------------------------------
// GET /api/admin/overview
// ---------------------------------------------------------------------------
router.get("/overview", async (req, res) => {
  try {
    const [
      ledgerTotals,
      orderCounts,
      heldOrders,
      disputes,
      businessRequests,
      unverifiedProviders,
      openOffers,
      inspectionStats,
      openInvoices,
    ] = await Promise.all([
      LedgerEntry.aggregate([{ $group: { _id: "$type", paise: { $sum: "$amountPaise" } } }]),
      Order.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Order.find({ "settlement.status": "held" }).select("charges.grandTotal totalAmount"),
      Order.countDocuments({ "settlement.status": "disputed" }),
      User.countDocuments({ "business.status": "requested" }),
      LogisticsProvider.countDocuments({ verified: false }),
      LogisticsAssignment.countDocuments({ status: "offered" }),
      Inspection.aggregate([
        { $group: { _id: { stage: "$stage", result: "$result" }, count: { $sum: 1 } } },
      ]),
      Order.find({ paymentMethod: "Invoice", paymentStatus: "Invoiced", status: { $nin: ["Cancelled", "Rejected"] } })
        .select("charges.grandTotal totalAmount invoice.dueAt"),
    ]);

    const byType = Object.fromEntries(ledgerTotals.map((r) => [r._id, r.paise]));
    const byStatus = Object.fromEntries(orderCounts.map((r) => [r._id, r.count]));

    const pickups = inspectionStats.filter((r) => r._id.stage === "pickup");
    const pickupTotal = pickups.reduce((s, r) => s + r.count, 0);
    const pickupPassed = pickups.find((r) => r._id.result === "passed")?.count || 0;

    res.json({
      money: {
        captured: rupees(byType.capture || 0),
        paidOut: rupees(byType.payout || 0),
        refunded: rupees(byType.refund || 0),
        platformRevenue: rupees(byType.platform_fee || 0),
        platformAdvances: rupees(byType.advance || 0),
        inEscrow: Math.round(
          heldOrders.reduce((s, o) => s + (o.charges?.grandTotal ?? o.totalAmount), 0) * 100
        ) / 100,
        outstandingInvoices: Math.round(
          openInvoices.reduce((s, o) => s + (o.charges?.grandTotal ?? o.totalAmount), 0) * 100
        ) / 100,
        overdueInvoices: openInvoices.filter((o) => o.invoice?.dueAt && o.invoice.dueAt < new Date()).length,
      },
      orders: byStatus,
      attention: {
        disputes,
        businessRequests,
        unverifiedProviders,
        openOffers,
      },
      quality: {
        pickupInspections: pickupTotal,
        pickupPassRatePct: pickupTotal ? Math.round((pickupPassed / pickupTotal) * 100) : null,
      },
    });
  } catch (error) {
    send(res, error, "ADMIN OVERVIEW ERROR");
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/audit?action=&entityType=&entityId=&page=&limit=
// ---------------------------------------------------------------------------
router.get("/audit", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const filter = {};

    if (req.query.action) {
      const escaped = String(req.query.action).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.action = new RegExp(`^${escaped}`);
    }
    if (req.query.entityType) filter.entityType = String(req.query.entityType);
    if (req.query.entityId && isValidId(req.query.entityId)) filter.entityId = req.query.entityId;

    const [total, entries] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    res.json({ page, limit, total, entries });
  } catch (error) {
    send(res, error, "ADMIN AUDIT ERROR");
  }
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
router.get("/settings", async (req, res) => {
  try {
    res.json({ settings: await getSettings() });
  } catch (error) {
    send(res, error, "ADMIN SETTINGS ERROR");
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { settings, changes, errors } = await updateSettings(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    if (changes.length) {
      await audit(req, "settings.updated", "PlatformSettings", settings._id, { changes });
    }
    res.json({
      message: changes.length ? `${changes.length} setting(s) updated.` : "No changes.",
      changes,
      settings,
    });
  } catch (error) {
    send(res, error, "ADMIN UPDATE SETTINGS ERROR");
  }
});

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
router.get("/disputes", async (req, res) => {
  try {
    const orders = await Order.find({ "settlement.status": "disputed" }).sort({
      "settlement.disputedAt": 1,
    });
    const inspections = await Inspection.find({ orderId: { $in: orders.map((o) => o._id) } }).lean();

    res.json({
      disputes: orders.map((order) => ({
        orderId: order._id,
        buyerName: order.buyerName,
        farmers: [...new Set(order.products.map((l) => l.farmerName))],
        crops: order.products.map((l) => `${l.quantity}kg ${l.cropName}`),
        goods: order.charges?.goods ?? order.totalAmount,
        grandTotal: order.charges?.grandTotal ?? order.totalAmount,
        carrier: order.logistics?.providerName || order.logistics?.mode || "unassigned",
        carrierLiability: order.logistics?.liability || null,
        disputedAt: order.settlement?.disputedAt,
        suggestedLiability: order.inspection?.liability,
        suggestionReason: order.inspection?.liabilityReason,
        inspections: inspections
          .filter((i) => String(i.orderId) === String(order._id))
          .map((i) => ({
            stage: i.stage,
            result: i.result,
            grade: i.grade,
            condition: i.condition,
            expectedKg: i.expectedKg,
            measuredKg: i.measuredKg,
            notes: i.notes,
            photos: i.photos,
            reasons: i.reasons,
            inspectorName: i.inspectorName,
            at: i.createdAt,
          })),
      })),
    });
  } catch (error) {
    send(res, error, "ADMIN DISPUTES ERROR");
  }
});

// POST /api/admin/disputes/:orderId/resolve  -  { liability, refundPct, notes }
router.post("/disputes/:orderId/resolve", async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ message: "Invalid order id." });
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found." });

    const { liability, refundPct, notes } = req.body || {};
    const outcome = await settlement.resolveDispute(order, req, { liability, refundPct, notes });
    await order.save();

    const balance = await settlement.ledgerBalance(order._id);

    res.json({
      message: "Dispute resolved.",
      settlementStatus: order.settlement.status,
      resolution: outcome.resolution,
      claimAgainstCarrier: outcome.claimAgainstCarrier,
      booksClosed: balance.stillHeld === 0,
    });
  } catch (error) {
    send(res, error, "ADMIN RESOLVE ERROR");
  }
});

// ---------------------------------------------------------------------------
// Business accounts
// ---------------------------------------------------------------------------
router.get("/business-accounts", async (req, res) => {
  try {
    const status = req.query.status || "requested";
    const users = await User.find({ role: "buyer", "business.status": status }).sort({ updatedAt: 1 });
    res.json({
      accounts: users.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        location: u.location,
        accountType: u.accountType,
        business: u.business,
        memberSince: u.createdAt,
      })),
    });
  } catch (error) {
    send(res, error, "ADMIN BUSINESS LIST ERROR");
  }
});

// POST /api/admin/business-accounts/:userId
// { decision: "approve"|"decline", creditLimit?, paymentTerms? }
router.post("/business-accounts/:userId", async (req, res) => {
  try {
    if (!isValidId(req.params.userId)) return res.status(400).json({ message: "Invalid user id." });
    const user = await User.findOne({ _id: req.params.userId, role: "buyer" });
    if (!user) return res.status(404).json({ message: "Buyer not found." });

    const { decision } = req.body || {};
    if (!["approve", "decline"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be approve or decline." });
    }

    const business = user.business?.toObject ? user.business.toObject() : { ...(user.business || {}) };

    if (decision === "decline") {
      business.status = "declined";
      business.creditLimit = 0;
      business.paymentTerms = "prepaid";
      user.accountType = "consumer";
    } else {
      if (!business.gstin) {
        return res.status(409).json({ message: "This buyer has not submitted a GSTIN." });
      }
      const terms = req.body.paymentTerms || "prepaid";
      if (!["prepaid", "net15", "net30"].includes(terms)) {
        return res.status(400).json({ message: "Payment terms must be prepaid, net15 or net30." });
      }
      const limit = Number(req.body.creditLimit ?? 0);
      if (!Number.isFinite(limit) || limit < 0 || limit > 50000000) {
        return res.status(400).json({ message: "Credit limit must be between 0 and 5 crore." });
      }
      if (terms !== "prepaid" && limit <= 0) {
        return res.status(400).json({ message: "Credit terms need a credit limit above zero." });
      }
      business.status = "approved";
      business.paymentTerms = terms;
      business.creditLimit = terms === "prepaid" ? 0 : limit;
      user.accountType = "business";
    }

    business.reviewedAt = new Date();
    user.business = business;
    await user.save();

    await audit(req, `b2b.account_${decision}d`, "User", user._id, {
      creditLimit: business.creditLimit,
      paymentTerms: business.paymentTerms,
    });

    res.json({
      message: decision === "approve" ? "Business account verified." : "Business account declined.",
      account: { id: user._id, accountType: user.accountType, business: user.business },
    });
  } catch (error) {
    send(res, error, "ADMIN BUSINESS DECISION ERROR");
  }
});

// ---------------------------------------------------------------------------
// Logistics companies
// ---------------------------------------------------------------------------
router.get("/providers", async (req, res) => {
  try {
    const providers = await LogisticsProvider.find().sort({ verified: 1, createdAt: -1 });
    const owners = await User.find({ _id: { $in: providers.map((p) => p.ownerId) } }).select("name email");
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));
    const driverCounts = await User.aggregate([
      { $match: { role: "driver", providerId: { $in: providers.map((p) => p._id) } } },
      { $group: { _id: "$providerId", count: { $sum: 1 } } },
    ]);
    const driversById = new Map(driverCounts.map((r) => [String(r._id), r.count]));

    res.json({
      providers: providers.map((p) => ({
        ...p.toPublic(),
        active: p.active,
        stats: p.stats,
        owner: ownerById.get(String(p.ownerId))
          ? { name: ownerById.get(String(p.ownerId)).name, email: ownerById.get(String(p.ownerId)).email }
          : null,
        drivers: driversById.get(String(p._id)) || 0,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    send(res, error, "ADMIN PROVIDERS ERROR");
  }
});

// PATCH /api/admin/providers/:id  -  { verified?, active? }
router.patch("/providers/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid provider id." });
    const provider = await LogisticsProvider.findById(req.params.id);
    if (!provider) return res.status(404).json({ message: "Provider not found." });

    const changes = {};
    if (typeof req.body?.verified === "boolean") {
      changes.verified = { from: provider.verified, to: req.body.verified };
      provider.verified = req.body.verified;
    }
    if (typeof req.body?.active === "boolean") {
      changes.active = { from: provider.active, to: req.body.active };
      provider.active = req.body.active;
    }
    if (!Object.keys(changes).length) {
      return res.status(400).json({ message: "Send verified and/or active as true or false." });
    }

    await provider.save();
    await audit(req, "provider.moderated", "LogisticsProvider", provider._id, changes);
    res.json({ message: "Provider updated.", provider: { ...provider.toPublic(), active: provider.active } });
  } catch (error) {
    send(res, error, "ADMIN PROVIDER UPDATE ERROR");
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/ledger/:orderId  -  every money movement, and proof it closes
// ---------------------------------------------------------------------------
router.get("/ledger/:orderId", async (req, res) => {
  try {
    if (!isValidId(req.params.orderId)) return res.status(400).json({ message: "Invalid order id." });
    const [rows, balance] = await Promise.all([
      LedgerEntry.find({ orderId: req.params.orderId }).sort({ createdAt: 1 }).lean(),
      settlement.ledgerBalance(req.params.orderId),
    ]);
    res.json({
      rows: rows.map((r) => ({ ...r, amount: rupees(r.amountPaise) })),
      balance: Object.fromEntries(
        Object.entries(balance).map(([k, v]) => [k, k === "rows" ? v : rupees(v)])
      ),
    });
  } catch (error) {
    send(res, error, "ADMIN LEDGER ERROR");
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/pairs?limit=  -  best farmer-to-buyer pairings platform-wide
// ---------------------------------------------------------------------------
router.get("/pairs", async (req, res) => {
  try {
    res.json(await topPairs({ limit: req.query.limit }));
  } catch (error) {
    send(res, error, "ADMIN PAIRS ERROR");
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/sweeps/run  -  run the timed jobs now
// ---------------------------------------------------------------------------
router.post("/sweeps/run", async (req, res) => {
  try {
    const [released, offersMoved] = await Promise.all([
      settlement.sweepAutoRelease(),
      sweepExpiredOffers(),
    ]);
    await audit(req, "ops.sweeps_run", "System", null, { released, offersMoved });
    res.json({ released, offersMoved });
  } catch (error) {
    send(res, error, "ADMIN SWEEPS ERROR");
  }
});

module.exports = router;
