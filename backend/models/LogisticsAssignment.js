const mongoose = require("mongoose");

/**
 * An offer of one delivery to one logistics company.
 *
 * When a farmer accepts an order, the best-quoted eligible company gets an
 * offer. It accepts (naming the driver who will run it) or declines; a decline
 * or an expiry passes the order to the next company, and when the list runs
 * out the order falls back to FarmLink's independent delivery partners.
 *
 * The quote and the liability terms are frozen onto the offer at the moment
 * it is made, so a carrier later changing its rate card cannot reprice or
 * re-scope a job it already took.
 */
const logisticsAssignmentSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LogisticsProvider",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["offered", "accepted", "rejected", "expired", "cancelled"],
      default: "offered",
      index: true,
    },

    // Position in the ranked list this offer came from (1 = cheapest).
    rank: { type: Number, default: 1 },

    quote: {
      distanceKm: Number,
      durationMin: Number,
      weightKg: Number,
      // What the carrier is paid.
      providerFee: Number,
      routeSource: String,
    },

    liability: {
      coveragePct: Number,
      maxPerOrder: Number,
    },

    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reason: { type: String, default: "", maxlength: 300 },

    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// A company is never offered the same order twice.
logisticsAssignmentSchema.index({ orderId: 1, providerId: 1 }, { unique: true });

module.exports = mongoose.model("LogisticsAssignment", logisticsAssignmentSchema);
