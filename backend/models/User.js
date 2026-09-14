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

// Optional exact position. When present it beats geocoding the city name,
// so distances and delivery quotes are measured from the real farm or door.
const coordinatesSchema = new mongoose.Schema(
  {
    lat: { type: Number, min: -90, max: 90 },
    lng: { type: Number, min: -180, max: 180 },
  },
  { _id: false }
);

// Wholesale buyers. Credit terms are granted by an admin, never self-assigned.
const businessSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: "", trim: true, maxlength: 160 },
    gstin: { type: String, default: "", trim: true, uppercase: true, maxlength: 15 },
    // "requested" until an admin reviews it.
    status: {
      type: String,
      enum: ["none", "requested", "approved", "declined"],
      default: "none",
    },
    creditLimit: { type: Number, min: 0, default: 0 },
    paymentTerms: {
      type: String,
      enum: ["prepaid", "net15", "net30"],
      default: "prepaid",
    },
    reviewedAt: { type: Date, default: null },
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

    // "logistics" is a third-party carrier's company account. "admin" can
    // never be self-registered - see scripts/create-admin.js.
    role: {
      type: String,
      enum: ["farmer", "buyer", "driver", "logistics", "admin"],
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

    coordinates: { type: coordinatesSchema, default: undefined },

    // Buyers only: retail consumer or wholesale business.
    accountType: {
      type: String,
      enum: ["consumer", "business"],
      default: "consumer",
    },
    business: { type: businessSchema, default: () => ({}) },

    // Drivers only: the logistics company they drive for, if any.
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LogisticsProvider",
      default: null,
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
    coordinates: this.coordinates || null,
    accountType: this.accountType || "consumer",
    business: this.business || { status: "none" },
    providerId: this.providerId || null,
    createdAt: this.createdAt,
  };
};

/** Business buyers whose credit an admin has approved. */
userSchema.methods.hasApprovedCredit = function hasApprovedCredit() {
  return (
    this.role === "buyer" &&
    this.accountType === "business" &&
    this.business?.status === "approved" &&
    this.business?.paymentTerms !== "prepaid" &&
    (this.business?.creditLimit || 0) > 0
  );
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
