const mongoose = require("mongoose");

const MESSAGE_MAX = 2000;

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderName: { type: String, required: true },
    senderRole: {
      type: String,
      enum: ["farmer", "buyer", "driver"],
      required: true,
    },
    body: { type: String, required: true, trim: true, maxlength: MESSAGE_MAX },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const conversationSchema = new mongoose.Schema(
  {
    // "buyer-farmer" : freshness questions and price negotiation
    // "buyer-driver" : delivery instructions once a driver is assigned
    kind: {
      type: String,
      enum: ["buyer-farmer", "buyer-driver"],
      required: true,
    },

    // Everyone allowed to read / post. Queried on directly.
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    ],

    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    buyerName: { type: String, default: "" },

    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    farmerName: { type: String, default: "" },

    driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    driverName: { type: String, default: "" },

    // What the thread is about (one of the two is usually set)
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },

    subject: { type: String, default: "" },

    messages: [messageSchema],

    lastMessageAt: { type: Date, default: Date.now },
    lastMessageText: { type: String, default: "" },
    lastSenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // userId (string) -> the moment that user last opened the thread
    readAt: {
      type: Map,
      of: Date,
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1 });

// How many messages this user has not seen yet.
conversationSchema.methods.unreadFor = function unreadFor(userId) {
  const seenAt = this.readAt.get(String(userId));
  return this.messages.reduce((count, message) => {
    const fromSomeoneElse = String(message.senderId) !== String(userId);
    const isNew = !seenAt || message.createdAt > seenAt;
    return count + (fromSomeoneElse && isNew ? 1 : 0);
  }, 0);
};

// Trimmed shape for a list row - no full message history.
conversationSchema.methods.toSummary = function toSummary(userId) {
  const meIsBuyer = String(this.buyerId) === String(userId);

  let other = { name: "FarmLink", role: "system" };
  if (this.kind === "buyer-farmer") {
    other = meIsBuyer
      ? { id: this.farmerId, name: this.farmerName, role: "farmer" }
      : { id: this.buyerId, name: this.buyerName, role: "buyer" };
  } else {
    other = meIsBuyer
      ? { id: this.driverId, name: this.driverName, role: "driver" }
      : { id: this.buyerId, name: this.buyerName, role: "buyer" };
  }

  return {
    _id: this._id,
    kind: this.kind,
    subject: this.subject,
    productId: this.productId,
    orderId: this.orderId,
    other,
    lastMessageText: this.lastMessageText,
    lastMessageAt: this.lastMessageAt,
    lastSenderId: this.lastSenderId,
    unread: this.unreadFor(userId),
    updatedAt: this.updatedAt,
  };
};

const Conversation = mongoose.model("Conversation", conversationSchema);

module.exports = Conversation;
module.exports.MESSAGE_MAX = MESSAGE_MAX;
