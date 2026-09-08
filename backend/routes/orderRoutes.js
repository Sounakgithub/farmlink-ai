const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { protect, requireRole } = require("../middleware/auth");

const router = express.Router();

const ACTIVE_STATUSES = ["Pending", "Accepted", "Confirmed", "In Transit"];

// Who is allowed to move an order from X to Y.
const TRANSITIONS = {
  farmer: {
    Pending: ["Accepted", "Rejected"],
  },
  driver: {
    Accepted: ["In Transit"],
    Confirmed: ["In Transit"],
    "In Transit": ["Delivered"],
  },
  buyer: {
    Pending: ["Cancelled"],
    Accepted: ["Cancelled"],
    Confirmed: ["Cancelled"],
  },
};

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Restrict a query to what this role is allowed to see.
function scopeForUser(user) {
  if (user.role === "buyer") return { buyerId: user._id };
  if (user.role === "farmer") return { "products.farmerId": user._id };
  return {}; // driver sees the delivery pool
}

// A farmer must only ever see their own lines / totals within a shared order.
function projectForUser(order, user) {
  const plain = order.toObject ? order.toObject() : order;

  if (user.role !== "farmer") return plain;

  const myLines = plain.products.filter(
    (line) => String(line.farmerId) === String(user._id)
  );

  return {
    ...plain,
    products: myLines,
    totalAmount: myLines.reduce((sum, l) => sum + l.totalPrice, 0),
    fullOrderAmount: plain.totalAmount,
  };
}

async function restoreStock(order) {
  await Promise.all(
    order.products.map((line) =>
      Product.updateOne(
        { _id: line.productId },
        { $inc: { quantity: line.quantity } }
      )
    )
  );
}

// ---------------------------------------------------------------------------
// POST /api/orders  -  buyer places an order
// Prices, totals and the farmer for each line are read from the database,
// never trusted from the request body.
// ---------------------------------------------------------------------------
router.post("/", protect, requireRole("buyer"), async (req, res) => {
  try {
    const { items, deliveryAddress } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Your cart is empty." });
    }

    const lines = [];
    const stockUpdates = [];

    for (const item of items) {
      if (!isValidId(item.productId)) {
        return res.status(400).json({ message: "Invalid product in cart." });
      }

      const product = await Product.findById(item.productId);

      if (!product) {
        return res.status(404).json({
          message: `A product in your cart is no longer available.`,
        });
      }

      const quantity = Number(item.quantity);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({
          message: `Invalid quantity for ${product.cropName}.`,
        });
      }

      if (quantity > product.quantity) {
        return res.status(409).json({
          message: `Only ${product.quantity} ${product.unit} of ${product.cropName} left in stock.`,
        });
      }

      lines.push({
        productId: product._id,
        cropName: product.cropName,
        farmerId: product.farmerId,
        farmerName: product.farmerName,
        location: product.location,
        quantity,
        pricePerKg: product.pricePerKg,
        totalPrice: quantity * product.pricePerKg,
      });

      stockUpdates.push({ id: product._id, quantity });
    }

    const totalAmount = lines.reduce((sum, l) => sum + l.totalPrice, 0);

    const order = await Order.create({
      buyerId: req.user._id,
      buyerName: req.user.name,
      buyerEmail: req.user.email,
      deliveryAddress: deliveryAddress || req.user.location || "",
      products: lines,
      totalAmount,
      status: "Pending",
      statusHistory: [{ status: "Pending", by: req.user.name }],
    });

    // Reserve the stock now that the order exists.
    await Promise.all(
      stockUpdates.map((u) =>
        Product.updateOne({ _id: u.id }, { $inc: { quantity: -u.quantity } })
      )
    );

    res.status(201).json({ message: "Order placed successfully", order });
  } catch (error) {
    console.error("CREATE ORDER ERROR:", error);
    res.status(400).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders  -  role-scoped list
// ---------------------------------------------------------------------------
router.get("/", protect, async (req, res) => {
  try {
    const filter = { ...scopeForUser(req.user) };

    if (req.query.status) {
      filter.status = req.query.status;
    } else if (req.query.active === "true") {
      filter.status = { $in: ACTIVE_STATUSES };
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });

    res.json(orders.map((order) => projectForUser(order, req.user)));
  } catch (error) {
    console.error("GET ORDERS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/stats  -  role-aware headline numbers
// ---------------------------------------------------------------------------
router.get("/stats", protect, async (req, res) => {
  try {
    const orders = await Order.find(scopeForUser(req.user));

    const amountFor = (order) => {
      if (req.user.role !== "farmer") return order.totalAmount;
      return order.products
        .filter((l) => String(l.farmerId) === String(req.user._id))
        .reduce((sum, l) => sum + l.totalPrice, 0);
    };

    const stats = {
      total: orders.length,
      pending: 0,
      active: 0,
      delivered: 0,
      cancelled: 0,
      totalValue: 0,
      completedValue: 0,
    };

    for (const order of orders) {
      const value = amountFor(order);
      stats.totalValue += value;

      if (order.status === "Pending") stats.pending += 1;
      if (ACTIVE_STATUSES.includes(order.status)) stats.active += 1;
      if (order.status === "Delivered") {
        stats.delivered += 1;
        stats.completedValue += value;
      }
      if (["Cancelled", "Rejected"].includes(order.status)) stats.cancelled += 1;
    }

    res.json(stats);
  } catch (error) {
    console.error("ORDER STATS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------
router.get("/:id", protect, async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      ...scopeForUser(req.user),
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    res.json(projectForUser(order, req.user));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status  -  guarded state machine
// ---------------------------------------------------------------------------
router.patch("/:id/status", protect, async (req, res) => {
  try {
    const { status } = req.body;

    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      ...scopeForUser(req.user),
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const allowed = (TRANSITIONS[req.user.role] || {})[order.status] || [];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: `A ${req.user.role} cannot change an order from "${order.status}" to "${status}".`,
        allowedNext: allowed,
      });
    }

    // Returning stock when an order will not be fulfilled.
    if (["Rejected", "Cancelled"].includes(status)) {
      await restoreStock(order);
    }

    if (status === "In Transit" && req.user.role === "driver") {
      order.driverId = req.user._id;
    }

    order.status = status;
    order.statusHistory.push({ status, by: req.user.name });

    const updated = await order.save();

    res.json({
      message: `Order marked as ${status}`,
      order: projectForUser(updated, req.user),
    });
  } catch (error) {
    console.error("UPDATE STATUS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/cancel  -  buyer shortcut
// ---------------------------------------------------------------------------
router.patch("/:id/cancel", protect, requireRole("buyer"), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.status === "Delivered") {
      return res.status(400).json({
        message: "A delivered order cannot be cancelled.",
      });
    }

    if (["Cancelled", "Rejected"].includes(order.status)) {
      return res.status(400).json({ message: "This order is already closed." });
    }

    if (order.status === "In Transit") {
      return res.status(400).json({
        message: "This order is already on its way and cannot be cancelled.",
      });
    }

    await restoreStock(order);

    order.status = "Cancelled";
    order.statusHistory.push({ status: "Cancelled", by: req.user.name });

    const updated = await order.save();

    res.json({ message: "Order cancelled successfully", order: updated });
  } catch (error) {
    console.error("CANCEL ORDER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/location  -  driver GPS ping
// ---------------------------------------------------------------------------
router.patch("/:id/location", protect, requireRole("driver"), async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({
        message: "A numeric latitude and longitude are required.",
      });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    order.driverLocation = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      updatedAt: new Date(),
    };

    const updated = await order.save();

    res.json({
      message: "Driver location updated",
      driverLocation: updated.driverLocation,
    });
  } catch (error) {
    console.error("UPDATE LOCATION ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
