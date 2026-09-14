const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Inspection = require("../models/Inspection");
const { protect, requireRole } = require("../middleware/auth");
const {
  recordPickupInspection,
  recordDeliveryInspection,
} = require("../utils/inspection");
const { getSettings } = require("../utils/settings");

const router = express.Router();

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

function send(res, error) {
  if (!error.status) console.error("INSPECTION ERROR:", error);
  res.status(error.status || 500).json({
    message: error.message,
    ...(error.problems ? { problems: error.problems } : {}),
    ...(error.inspection ? { inspection: error.inspection } : {}),
  });
}

async function loadOrder(req, res) {
  if (!isValidId(req.params.orderId)) {
    res.status(400).json({ message: "Invalid order id." });
    return null;
  }
  const order = await Order.findById(req.params.orderId);
  if (!order) {
    res.status(404).json({ message: "Order not found." });
    return null;
  }
  return order;
}

// ---------------------------------------------------------------------------
// GET /api/inspections/policy  -  the rules inspectors are held to
// ---------------------------------------------------------------------------
router.get("/policy", protect, async (req, res) => {
  const settings = await getSettings();
  res.json({
    requirePickupInspection: settings.inspection.requirePickupInspection,
    weightTolerancePct: settings.inspection.weightTolerancePct,
    grades: {
      A: "Premium - uniform, fresh, no defects",
      B: "Standard - minor cosmetic variation",
      C: "Marginal - saleable but visibly aged or uneven",
      REJECT: "Unfit to ship - needs notes and at least one photo",
    },
    failsPickup: [
      "Grade REJECT",
      "Failed freshness check",
      "Pest damage or infestation",
      "Weight short beyond tolerance",
    ],
    autoReleaseHours: settings.escrow.autoReleaseHours,
  });
});

// ---------------------------------------------------------------------------
// POST /api/inspections/order/:orderId/pickup
// body: { grade, checks: { freshness, packaging, pestFree, moistureOk },
//         measuredKg?, notes?, photos?: [url] }
// The collecting driver, or an admin inspector.
// ---------------------------------------------------------------------------
router.post(
  "/order/:orderId/pickup",
  protect,
  requireRole("driver", "admin"),
  async (req, res) => {
    try {
      const order = await loadOrder(req, res);
      if (!order) return;

      const { inspection, verdict } = await recordPickupInspection(order, req, req.body || {});

      res.status(201).json({
        message:
          verdict.result === "passed"
            ? "Pickup inspection passed - the goods can leave the farm."
            : "Pickup inspection failed - the order was rejected and the buyer refunded.",
        result: verdict.result,
        reasons: verdict.reasons,
        inspectionId: inspection._id,
        orderStatus: order.status,
      });
    } catch (error) {
      send(res, error);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/inspections/order/:orderId/delivery
// body: { condition: good|damaged|short|spoiled, receivedKg?, notes?, photos? }
// The buyer, once the order is delivered.
// ---------------------------------------------------------------------------
router.post(
  "/order/:orderId/delivery",
  protect,
  requireRole("buyer"),
  async (req, res) => {
    try {
      const order = await loadOrder(req, res);
      if (!order) return;

      const outcome = await recordDeliveryInspection(order, req, req.body || {});

      res.status(201).json({
        message:
          outcome.verdict.result === "passed"
            ? "Thanks - delivery confirmed and payment released to the farmer and carrier."
            : "Your report has been recorded and payment is on hold while it is reviewed.",
        result: outcome.verdict.result,
        reasons: outcome.verdict.reasons,
        liability: outcome.liability,
        liabilityReason: outcome.liabilityReason,
        settlementStatus: order.settlement?.status,
        inspectionId: outcome.inspection._id,
      });
    } catch (error) {
      send(res, error);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/inspections/farmer/me  -  a farmer's own quality record
// ---------------------------------------------------------------------------
router.get("/farmer/me", protect, requireRole("farmer"), async (req, res) => {
  try {
    const pickups = await Inspection.find({ farmerIds: req.user._id, stage: "pickup" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const counts = { A: 0, B: 0, C: 0, REJECT: 0 };
    for (const p of pickups) if (counts[p.grade] !== undefined) counts[p.grade] += 1;
    const passed = pickups.filter((p) => p.result === "passed").length;

    res.json({
      inspected: pickups.length,
      passRatePct: pickups.length ? Math.round((passed / pickups.length) * 100) : null,
      grades: counts,
      recent: pickups.slice(0, 10).map((p) => ({
        orderId: p.orderId,
        grade: p.grade,
        result: p.result,
        reasons: p.reasons,
        notes: p.notes,
        photos: p.photos,
        at: p.createdAt,
      })),
    });
  } catch (error) {
    send(res, error);
  }
});

module.exports = router;
