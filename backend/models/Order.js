const mongoose = require("mongoose");

const ORDER_STATUSES = [
  "Pending",
  "Accepted",
  "Rejected",
  "Confirmed", // legacy alias for Accepted, kept so older rows still save
  "In Transit",
  "Delivered",
  "Cancelled",
];

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    cropName: {
      type: String,
      required: true,
    },

    // kept per line so an order can span several farmers
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

    location: {
      type: String,
      default: "",
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    pricePerKg: {
      type: Number,
      required: true,
    },

    totalPrice: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Money. `totalAmount` keeps its original meaning (the goods total) so every
// existing screen and report is unaffected; the full picture of what the buyer
// pays and where each rupee goes lives here.
// ---------------------------------------------------------------------------
const chargesSchema = new mongoose.Schema(
  {
    goods: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },

    feeTier: { type: String, enum: ["consumer", "business"], default: "consumer" },
    commissionPct: { type: Number, default: 0 },
    logisticsMarkupPct: { type: Number, default: 0 },

    // Where the grand total goes. Always sums back to grandTotal.
    commission: { type: Number, default: 0 },
    logisticsMarkup: { type: Number, default: 0 },
    farmerPayout: { type: Number, default: 0 },
    logisticsPayout: { type: Number, default: 0 },
    platformRevenue: { type: Number, default: 0 },

    // The route the delivery fee was priced on.
    quote: {
      distanceKm: Number,
      durationMin: Number,
      weightKg: Number,
      routeSource: String,
      approximate: Boolean,
      needsRefrigeration: Boolean,
      carrier: { type: String, enum: ["provider", "independent"] },
      providerId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsProvider" },
      providerName: String,
    },
  },
  { _id: false }
);

// Escrow. Buyer money is held until the buyer confirms good condition, the
// release window lapses without a dispute, or an admin decides a dispute.
const settlementSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "awaiting_payment", // cash on delivery, not yet collected
        "invoiced", // wholesale credit terms, not yet paid
        "held", // money received, in escrow
        "released", // paid out to farmer, carrier and platform
        "refunded", // returned in full to the buyer
        "disputed", // frozen pending an admin decision
        "partially_refunded", // dispute decided with a partial refund
        "voided", // order ended before any money was taken
      ],
      default: "awaiting_payment",
    },
    heldAt: Date,
    autoReleaseAt: Date,
    releasedAt: Date,
    refundedAt: Date,
    disputedAt: Date,
    resolution: {
      liability: { type: String, enum: ["farmer", "logistics", "shared", "none"] },
      refundPct: Number,
      refundAmount: Number,
      notes: String,
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      decidedAt: Date,
    },
  },
  { _id: false }
);

// A summary of the two inspections, so lists render without extra queries.
const inspectionSummarySchema = new mongoose.Schema(
  {
    pickup: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Inspection" },
      result: String,
      grade: String,
      at: Date,
    },
    delivery: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Inspection" },
      result: String,
      condition: String,
      at: Date,
    },
    // Who carries the loss if something went wrong.
    liability: {
      type: String,
      enum: ["none", "farmer", "logistics", "shared", "undetermined"],
      default: "none",
    },
    liabilityReason: String,
  },
  { _id: false }
);

const logisticsSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ["unassigned", "offered", "provider", "independent"],
      default: "unassigned",
    },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsProvider" },
    providerName: String,
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsAssignment" },
    offersMade: { type: Number, default: 0 },
    // Frozen at acceptance.
    liability: {
      coveragePct: Number,
      maxPerOrder: Number,
    },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    number: String,
    terms: { type: String, enum: ["net15", "net30"] },
    issuedAt: Date,
    dueAt: Date,
    paidAt: Date,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    buyerName: {
      type: String,
      required: true,
    },

    buyerEmail: {
      type: String,
      required: true,
    },

    deliveryAddress: {
      type: String,
      default: "",
    },

    deliveryInstructions: {
      type: String,
      default: "",
      maxlength: 500,
      trim: true,
    },

    paymentMethod: {
      type: String,
      enum: ["Cash on Delivery", "UPI", "Card", "Net Banking", "Invoice"],
      default: "Cash on Delivery",
    },

    // "Pending" until a COD order is delivered; prepaid methods flip to "Paid"
    // as soon as the order is placed. "Refunded" once a prepaid order is voided.
    // "Invoiced" is a wholesale order on credit terms, not yet paid.
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Refunded", "Invoiced"],
      default: "Pending",
    },

    // How the order arrived.
    channel: { type: String, enum: ["b2c", "b2b", "api"], default: "b2c" },

    products: {
      type: [orderItemSchema],
      validate: [
        (value) => Array.isArray(value) && value.length > 0,
        "An order needs at least one product",
      ],
    },

    totalAmount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: "Pending",
    },

    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    driverLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      updatedAt: { type: Date },
    },

    charges: { type: chargesSchema, default: () => ({}) },
    settlement: { type: settlementSchema, default: () => ({}) },
    inspection: { type: inspectionSummarySchema, default: () => ({}) },
    logistics: { type: logisticsSchema, default: () => ({}) },
    invoice: { type: invoiceSchema, default: undefined },

    statusHistory: [
      {
        status: { type: String, enum: ORDER_STATUSES },
        at: { type: Date, default: Date.now },
        by: { type: String, default: "" },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Convenience: every farmer with a line in this order.
orderSchema.methods.farmerIds = function farmerIds() {
  return [...new Set(this.products.map((p) => String(p.farmerId)))];
};

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;
module.exports.ORDER_STATUSES = ORDER_STATUSES;
// What a buyer may choose at an ordinary checkout. "Invoice" is only ever set
// by the wholesale flow, for accounts an admin has granted credit.
module.exports.PAYMENT_METHODS = [
  "Cash on Delivery",
  "UPI",
  "Card",
  "Net Banking",
];
