const mongoose = require("mongoose");

/**
 * A quality check at one end of the journey.
 *
 * Every order gets up to two, which together form a chain of custody:
 *
 *   pickup    recorded by whoever collects the goods at the farm (or an admin
 *             inspector). Grade, weight actually loaded, freshness checks.
 *             Goods cannot leave the farm until this passes.
 *
 *   delivery  recorded by the buyer on receipt. Condition, weight received.
 *
 * Comparing the two is what decides liability when something goes wrong: if
 * produce left the farm graded A and arrived crushed, that happened in
 * transit; if it failed at the farm gate, it never shipped.
 */

const GRADES = ["A", "B", "C", "REJECT"];
const CONDITIONS = ["good", "damaged", "short", "spoiled"];

const inspectionSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    stage: { type: String, enum: ["pickup", "delivery"], required: true },

    // Denormalised so a farmer's quality history is one query away.
    farmerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],

    inspectorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    inspectorRole: { type: String, required: true },
    inspectorName: { type: String, default: "" },

    // ---- pickup -----------------------------------------------------------
    grade: { type: String, enum: [...GRADES, null], default: null },
    checks: {
      freshness: { type: Boolean, default: null },
      packaging: { type: Boolean, default: null },
      pestFree: { type: Boolean, default: null },
      moistureOk: { type: Boolean, default: null },
    },
    // What was actually loaded / received, against what was ordered.
    expectedKg: { type: Number, default: null },
    measuredKg: { type: Number, default: null },

    // ---- delivery ---------------------------------------------------------
    condition: { type: String, enum: [...CONDITIONS, null], default: null },

    notes: { type: String, default: "", maxlength: 1000, trim: true },

    // Evidence. URLs, the same way product images are stored.
    photos: {
      type: [String],
      default: [],
      validate: {
        validator: (list) => list.length <= 8,
        message: "At most 8 photos per inspection.",
      },
    },

    result: {
      type: String,
      enum: ["passed", "failed", "disputed"],
      required: true,
    },

    // Why it failed or was disputed, in plain words.
    reasons: { type: [String], default: [] },
  },
  { timestamps: true }
);

// One inspection per stage per order; a second attempt replaces nothing.
inspectionSchema.index({ orderId: 1, stage: 1 }, { unique: true });

module.exports = mongoose.model("Inspection", inspectionSchema);
module.exports.GRADES = GRADES;
module.exports.CONDITIONS = CONDITIONS;
