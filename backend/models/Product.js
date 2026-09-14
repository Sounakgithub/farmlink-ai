const mongoose = require("mongoose");

// Optional exact position. When present it beats geocoding the city name,
// so distances and delivery quotes are measured from the real farm or door.
const coordinatesSchema = new mongoose.Schema(
  {
    lat: { type: Number, min: -90, max: 90 },
    lng: { type: Number, min: -180, max: 180 },
  },
  { _id: false }
);

// Volume pricing: buy at least `minQuantityKg` and pay `pricePerKg`.
const bulkTierSchema = new mongoose.Schema(
  {
    minQuantityKg: { type: Number, required: true, min: 1 },
    pricePerKg: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    farmerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    farmerName: {
      type: String,
      required: true,
    },

    cropName: {
      type: String,
      required: true,
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: [0, "Quantity cannot be negative"],
    },

    unit: {
      type: String,
      enum: ["kg", "quintal", "ton"],
      default: "kg",
    },

    location: {
      type: String,
      required: true,
      trim: true,
    },

    pricePerKg: {
      type: Number,
      required: true,
      min: [1, "Price must be at least 1"],
    },

    image: {
      type: String,
      default: "",
    },

    coordinates: { type: coordinatesSchema, default: undefined },

    // Optional. Each tier must be cheaper than the one below it, and every
    // tier cheaper than the base price - enforced on save.
    bulkTiers: {
      type: [bulkTierSchema],
      default: [],
      validate: {
        validator(tiers) {
          const sorted = [...tiers].sort((a, b) => a.minQuantityKg - b.minQuantityKg);
          let lastPrice = Infinity;
          for (const tier of sorted) {
            if (tier.pricePerKg >= lastPrice) return false;
            lastPrice = tier.pricePerKg;
          }
          return tiers.length <= 5;
        },
        message:
          "Bulk tiers must get cheaper as quantity rises, with at most 5 tiers.",
      },
    },

    // Produce that must travel chilled restricts which carriers qualify.
    needsRefrigeration: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

/** The per-kg price for a given quantity, honouring any bulk tier. */
productSchema.methods.priceFor = function priceFor(quantityKg) {
  const qty = Number(quantityKg) || 0;
  const tier = [...(this.bulkTiers || [])]
    .filter((t) => qty >= t.minQuantityKg && t.pricePerKg < this.pricePerKg)
    .sort((a, b) => b.minQuantityKg - a.minQuantityKg)[0];
  return tier ? tier.pricePerKg : this.pricePerKg;
};

// A crop is only buyable while there is stock left.
productSchema.virtual("inStock").get(function inStock() {
  return this.quantity > 0;
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

const Product = mongoose.model("Product", productSchema);

module.exports = Product;
