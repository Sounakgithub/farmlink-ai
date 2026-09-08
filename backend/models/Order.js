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
