const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * A third-party logistics company (3PL).
 *
 * Owned by a user with role "logistics". It publishes where it operates, what
 * it charges, how much it can carry and what it will pay out if goods are
 * damaged in its care. Drivers join it with a join code, and it is offered
 * deliveries whose route it covers.
 *
 * When no active company covers a route, FarmLink falls back to its pool of
 * independent delivery partners - so an order never stalls for want of one.
 */

const rateCardSchema = new mongoose.Schema(
  {
    baseFee: { type: Number, min: 0, default: 40 },
    perKm: { type: Number, min: 0, default: 7 },
    perKg: { type: Number, min: 0, default: 0.25 },
    minFee: { type: Number, min: 0, default: 60 },
  },
  { _id: false }
);

const logisticsProviderSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    contactEmail: { type: String, default: "", trim: true, lowercase: true },
    contactPhone: { type: String, default: "", trim: true },

    // City names it serves. A route qualifies when both ends are covered.
    coverageCities: {
      type: [String],
      default: [],
      set: (list) =>
        [...new Set((list || []).map((c) => String(c).trim()).filter(Boolean))].slice(0, 50),
    },

    rateCard: { type: rateCardSchema, default: () => ({}) },

    // Largest single load it will take.
    maxLoadKg: { type: Number, min: 1, default: 2000 },

    vehicleTypes: { type: [String], default: ["mini-truck"] },
    refrigerated: { type: Boolean, default: false },

    // What it accepts responsibility for when goods are damaged in transit.
    liability: {
      // Share of the goods value it will reimburse.
      coveragePct: { type: Number, min: 0, max: 100, default: 80 },
      // Cap per order, in rupees.
      maxPerOrder: { type: Number, min: 0, default: 25000 },
    },

    // Drivers enter this to join the company.
    joinCode: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(4).toString("hex").toUpperCase(),
    },

    // An admin must verify a company before it is offered any work.
    verified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },

    stats: {
      offered: { type: Number, default: 0 },
      accepted: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      damageClaims: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

/** Everything a buyer or farmer may see about a carrier. */
logisticsProviderSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    name: this.name,
    coverageCities: this.coverageCities,
    rateCard: this.rateCard,
    maxLoadKg: this.maxLoadKg,
    vehicleTypes: this.vehicleTypes,
    refrigerated: this.refrigerated,
    liability: this.liability,
    verified: this.verified,
    stats: {
      delivered: this.stats?.delivered || 0,
      damageClaims: this.stats?.damageClaims || 0,
    },
  };
};

module.exports = mongoose.model("LogisticsProvider", logisticsProviderSchema);
