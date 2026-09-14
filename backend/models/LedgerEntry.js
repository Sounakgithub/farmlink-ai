const mongoose = require("mongoose");

/**
 * One money movement.
 *
 * Every rupee that changes hands on an order leaves a row here: the buyer's
 * payment being captured into escrow, refunds, each party's payout, the
 * platform's fees, and any adjustment a dispute decision makes. Summing an
 * order's rows is how settlement is proven to balance.
 *
 * Amounts are integers in paise, never floating rupees, so a split can never
 * leak or invent a fraction of a rupee.
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    type: {
      type: String,
      required: true,
      enum: [
        "invoice", // wholesale order billed, money not yet received
        "capture", // buyer's money received into escrow
        "refund", // money returned to the buyer
        "payout", // money released to a farmer or carrier
        "platform_fee", // the platform's retained revenue
        "adjustment", // a dispute decision moving liability between parties
        "advance", // platform pays in its own funds, e.g. to front a refund
      ],
    },

    party: {
      type: String,
      required: true,
      enum: ["buyer", "farmer", "logistics", "platform"],
    },

    // The farmer / buyer / carrier-owner this concerns (null for platform).
    partyId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Positive paise. Direction is carried by `type`.
    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isInteger(value) && value >= 0,
        message: "Ledger amounts must be whole, non-negative paise.",
      },
    },

    currency: { type: String, default: "INR" },
    memo: { type: String, default: "" },

    // Which payment rail moved it: "mock", "cod", "invoice", or a real
    // gateway name once one is configured.
    gateway: { type: String, default: "mock" },
    gatewayRef: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ledgerEntrySchema.index({ partyId: 1, createdAt: -1 });

module.exports = mongoose.model("LedgerEntry", ledgerEntrySchema);
