const express = require("express");
const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const { MESSAGE_MAX } = require("../models/Conversation");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const shortId = (id) => `#${String(id).slice(-6).toUpperCase()}`;
const sameId = (a, b) => String(a) === String(b);

function isParticipant(convo, userId) {
  return convo.participants.some((p) => sameId(p, userId));
}

// ---------------------------------------------------------------------------
// GET /api/conversations  -  my threads, newest activity first
// ---------------------------------------------------------------------------
router.get("/", protect, async (req, res) => {
  try {
    const convos = await Conversation.find({ participants: req.user._id })
      .sort({ lastMessageAt: -1 })
      .limit(100);

    res.json(convos.map((c) => c.toSummary(req.user._id)));
  } catch (error) {
    console.error("LIST CONVERSATIONS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/conversations/unread-count  -  badge for the nav
// ---------------------------------------------------------------------------
router.get("/unread-count", protect, async (req, res) => {
  try {
    const convos = await Conversation.find({ participants: req.user._id });
    const count = convos.reduce((sum, c) => sum + c.unreadFor(req.user._id), 0);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/conversations  -  open (or reuse) a thread
// body: { kind, productId?, orderId? }
// ---------------------------------------------------------------------------
router.post("/", protect, async (req, res) => {
  try {
    const me = req.user;
    const { kind, productId, orderId } = req.body || {};

    if (!["buyer-farmer", "buyer-driver"].includes(kind)) {
      return res.status(400).json({ message: "Unknown conversation type." });
    }

    // ---- buyer <-> farmer ---------------------------------------------------
    if (kind === "buyer-farmer") {
      let buyer;
      let farmer;
      let product = null;
      let order = null;
      let subject = "";

      if (productId) {
        if (!isValidId(productId)) {
          return res.status(400).json({ message: "Invalid product." });
        }
        product = await Product.findById(productId);
        if (!product) {
          return res.status(404).json({ message: "That crop is no longer listed." });
        }

        // Only a buyer cold-starts a chat from a crop listing.
        if (me.role !== "buyer") {
          return res.status(403).json({
            message: "Only a buyer can start a chat from a crop listing.",
          });
        }

        buyer = me;
        farmer = await User.findById(product.farmerId);
        subject = product.cropName;
      } else if (orderId) {
        if (!isValidId(orderId)) {
          return res.status(400).json({ message: "Invalid order." });
        }
        order = await Order.findById(orderId);
        if (!order) {
          return res.status(404).json({ message: "Order not found." });
        }

        if (me.role === "buyer") {
          if (!sameId(order.buyerId, me._id)) {
            return res.status(403).json({ message: "That is not your order." });
          }
          buyer = me;
          farmer = await User.findById(order.products[0] && order.products[0].farmerId);
        } else if (me.role === "farmer") {
          const mine = order.products.some((l) => sameId(l.farmerId, me._id));
          if (!mine) {
            return res.status(403).json({
              message: "This order does not include any of your crops.",
            });
          }
          farmer = me;
          buyer = await User.findById(order.buyerId);
        } else {
          return res.status(403).json({ message: "Not allowed." });
        }
        subject = `Order ${shortId(order._id)}`;
      } else {
        return res.status(400).json({
          message: "A product or an order is required to start this chat.",
        });
      }

      if (!buyer || !farmer) {
        return res
          .status(404)
          .json({ message: "The other person could not be found." });
      }

      const lookup = { kind, buyerId: buyer._id, farmerId: farmer._id };
      if (product) lookup.productId = product._id;
      else lookup.orderId = order._id;

      let convo = await Conversation.findOne(lookup);
      if (!convo) {
        convo = await Conversation.create({
          ...lookup,
          participants: [buyer._id, farmer._id],
          buyerName: buyer.name,
          farmerName: farmer.name,
          subject,
        });
      }

      return res.status(201).json({ conversation: convo.toSummary(me._id) });
    }

    // ---- buyer <-> driver -------------------------------------------------
    if (!orderId || !isValidId(orderId)) {
      return res
        .status(400)
        .json({ message: "An order is required for this chat." });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }
    if (!order.driverId) {
      return res.status(409).json({
        message: "No delivery partner has been assigned to this order yet.",
      });
    }

    const isBuyer = sameId(order.buyerId, me._id);
    const isDriver = sameId(order.driverId, me._id);
    if (!isBuyer && !isDriver) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const buyer = isBuyer ? me : await User.findById(order.buyerId);
    const driver = isDriver ? me : await User.findById(order.driverId);

    const lookup = {
      kind,
      buyerId: buyer._id,
      driverId: driver._id,
      orderId: order._id,
    };

    let convo = await Conversation.findOne(lookup);
    if (!convo) {
      convo = await Conversation.create({
        ...lookup,
        participants: [buyer._id, driver._id],
        buyerName: buyer.name,
        driverName: driver.name,
        subject: `Delivery ${shortId(order._id)}`,
      });
    }

    return res.status(201).json({ conversation: convo.toSummary(me._id) });
  } catch (error) {
    console.error("OPEN CONVERSATION ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/conversations/:id  -  full thread (and mark it read)
// ---------------------------------------------------------------------------
router.get("/:id", protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid conversation id." });
    }

    const convo = await Conversation.findById(req.params.id);
    if (!convo || !isParticipant(convo, req.user._id)) {
      return res.status(404).json({ message: "Conversation not found." });
    }

    convo.readAt.set(String(req.user._id), new Date());
    await convo.save();

    res.json({
      ...convo.toSummary(req.user._id),
      messages: convo.messages,
    });
  } catch (error) {
    console.error("GET CONVERSATION ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/conversations/:id/messages  -  send one
// ---------------------------------------------------------------------------
router.post("/:id/messages", protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid conversation id." });
    }

    const body = String(req.body.body || "").trim();
    if (!body) {
      return res.status(400).json({ message: "Type a message first." });
    }
    if (body.length > MESSAGE_MAX) {
      return res.status(400).json({ message: "That message is too long." });
    }

    const convo = await Conversation.findById(req.params.id);
    if (!convo || !isParticipant(convo, req.user._id)) {
      return res.status(404).json({ message: "Conversation not found." });
    }

    convo.messages.push({
      senderId: req.user._id,
      senderName: req.user.name,
      senderRole: req.user.role,
      body,
    });
    convo.lastMessageAt = new Date();
    convo.lastMessageText = body;
    convo.lastSenderId = req.user._id;
    convo.readAt.set(String(req.user._id), new Date());

    await convo.save();

    res.status(201).json({
      message: convo.messages[convo.messages.length - 1],
      conversation: convo.toSummary(req.user._id),
    });
  } catch (error) {
    console.error("SEND MESSAGE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/conversations/:id/read
// ---------------------------------------------------------------------------
router.post("/:id/read", protect, async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo || !isParticipant(convo, req.user._id)) {
      return res.status(404).json({ message: "Conversation not found." });
    }
    convo.readAt.set(String(req.user._id), new Date());
    await convo.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
