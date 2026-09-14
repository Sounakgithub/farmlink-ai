const mongoose = require("mongoose");

/**
 * The platform's commercial and operational policy, in one editable document.
 *
 * Fees live here rather than in code so the business can tune them without a
 * deploy, and so every buyer and farmer can be shown exactly what applies to
 * them (GET /api/pricing/fees). Every change is audited.
 *
 * There is only ever one row, keyed "global".
 */

const feeTierSchema = new mongoose.Schema(
  {
    // Taken from the farmer's goods revenue on each completed order.
    commissionPct: { type: Number, min: 0, max: 30, default: 4 },

    // Added on top of the carrier's own rate; the buyer pays the marked-up
    // delivery fee, the carrier receives its rate, the platform keeps the gap.
    logisticsMarkupPct: { type: Number, min: 0, max: 50, default: 8 },
  },
  { _id: false }
);

const rateCardSchema = new mongoose.Schema(
  {
    baseFee: { type: Number, min: 0, default: 30 },
    perKm: { type: Number, min: 0, default: 6 },
    perKg: { type: Number, min: 0, default: 0.3 },
    minFee: { type: Number, min: 0, default: 40 },
  },
  { _id: false }
);

const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true },

    fees: {
      consumer: { type: feeTierSchema, default: () => ({}) },
      // Wholesale buyers trade in volume, so they get a thinner take.
      business: {
        type: feeTierSchema,
        default: () => ({ commissionPct: 2.5, logisticsMarkupPct: 6 }),
      },
    },

    // What an independent delivery partner is paid when no logistics company
    // covers the route.
    independentRateCard: { type: rateCardSchema, default: () => ({}) },

    inspection: {
      // Goods cannot leave the farm until a pickup inspection has passed.
      requirePickupInspection: { type: Boolean, default: true },
      // Accepted shortfall between listed and weighed quantity at pickup.
      weightTolerancePct: { type: Number, min: 0, max: 50, default: 5 },
    },

    escrow: {
      // If the buyer neither confirms nor disputes, funds release after this.
      autoReleaseHours: { type: Number, min: 1, max: 720, default: 48 },
    },

    logistics: {
      // How long a carrier has to accept an offer before it moves on.
      offerTtlMinutes: { type: Number, min: 1, max: 1440, default: 30 },
    },

    b2b: {
      // Smallest line a wholesale order may contain.
      minLineQuantityKg: { type: Number, min: 1, default: 50 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);
