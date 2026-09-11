const mongoose = require("mongoose");

// Optional buyer matching preferences.
//
// Every field is optional and every default is empty/null on purpose: an
// account created before this existed, or a buyer who never opens the
// preferences form, must keep working exactly as before. The matching engine
// treats "not set" as "no opinion" and falls back to order history, then to a
// neutral score - never to zero.
const buyerPreferencesSchema = new mongoose.Schema(
  {
    preferredCrops: { type: [String], default: [] },

    minPricePerKg: { type: Number, default: null, min: 0 },
    maxPricePerKg: { type: Number, default: null, min: 0 },

    minQuantityKg: { type: Number, default: null, min: 0 },
    preferredQuantityKg: { type: Number, default: null, min: 0 },
    maxQuantityKg: { type: Number, default: null, min: 0 },

    preferredLocations: { type: [String], default: [] },

    // How often this buyer expects to restock.
    purchaseFrequency: {
      type: String,
      enum: ["daily", "weekly", "fortnightly", "monthly", "occasional", ""],
      default: "",
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["farmer", "buyer", "driver"],
      required: true,
    },

    phone: {
      type: String,
      default: "",
      trim: true,
    },

    location: {
      type: String,
      default: "",
      trim: true,
    },

    // Only meaningful for role "buyer"; ignored for everyone else.
    buyerPreferences: {
      type: buyerPreferencesSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

// Never leak the password hash to a client.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    phone: this.phone,
    location: this.location,
    buyerPreferences: this.buyerPreferences || {},
    createdAt: this.createdAt,
  };
};

/**
 * What a *counterparty* is allowed to see - e.g. the buyer cards a farmer gets
 * back from AI matching. Deliberately drops email, phone, delivery addresses
 * and everything else private. Contact happens through the messaging system,
 * which never needs the other side's personal details.
 */
userSchema.methods.toPublicCard = function toPublicCard() {
  return {
    id: this._id,
    name: this.name,
    role: this.role,
    location: this.location,
    memberSince: this.createdAt,
  };
};

const User = mongoose.model("User", userSchema);

module.exports = User;
