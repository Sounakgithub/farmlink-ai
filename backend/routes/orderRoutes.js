const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const { protect, requireRole } = require("../middleware/auth");
const {
  geocode,
  approxNear,
  hashSeed,
  DEFAULT_DEPOT,
} = require("../utils/geocode");
const { haversineKm } = require("../utils/routeOptimizer");
const { pickDriverFor, driverCard } = require("../utils/driverAssignment");

const router = express.Router();

const ACTIVE_STATUSES = ["Pending", "Accepted", "Confirmed", "In Transit"];
const PAYMENT_METHODS = Order.PAYMENT_METHODS;
const PREPAID = ["UPI", "Card", "Net Banking"];

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

// Human-friendly order reference, matching the one the UI shows.
const shortId = (id) => `#${String(id).slice(-6).toUpperCase()}`;

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

// Attach the assigned delivery partner so the buyer knows who is bringing
// their order and how to reach them.
//
// Two bulk queries for the whole page, never one per order. Name, phone and
// city only - the email and everything else on the account stay private.
async function withDriver(orders) {
  const driverIds = [
    ...new Set(orders.filter((o) => o.driverId).map((o) => String(o.driverId))),
  ];
  if (driverIds.length === 0) return orders;

  const [drivers, completedCounts] = await Promise.all([
    User.find({ _id: { $in: driverIds } }).select("name phone location createdAt"),
    Order.aggregate([
      { $match: { driverId: { $in: driverIds.map((id) => new mongoose.Types.ObjectId(id)) }, status: "Delivered" } },
      { $group: { _id: "$driverId", count: { $sum: 1 } } },
    ]),
  ]);

  const byId = new Map(drivers.map((d) => [String(d._id), d]));
  const completedById = new Map(
    completedCounts.map((row) => [String(row._id), row.count])
  );

  return orders.map((order) => {
    if (!order.driverId) return order;
    const driver = byId.get(String(order.driverId));
    return {
      ...order,
      driver: driver
        ? {
            id: driver._id,
            name: driver.name,
            phone: driver.phone || "",
            location: driver.location || "",
            completedDeliveries: completedById.get(String(driver._id)) || 0,
            partnerSince: driver.createdAt,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// POST /api/orders  -  buyer places an order
// Prices, totals and the farmer for each line are read from the database,
// never trusted from the request body.
// ---------------------------------------------------------------------------
router.post("/", protect, requireRole("buyer"), async (req, res) => {
  try {
    const { items, deliveryAddress, deliveryInstructions, paymentMethod } =
      req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Your cart is empty." });
    }

    const method = paymentMethod || "Cash on Delivery";
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ message: "Choose a valid payment method." });
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
          message: `Choose how many kg of ${product.cropName} you want.`,
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
    const prepaid = PREPAID.includes(method);

    const order = await Order.create({
      buyerId: req.user._id,
      buyerName: req.user.name,
      buyerEmail: req.user.email,
      deliveryAddress: deliveryAddress || req.user.location || "",
      deliveryInstructions: (deliveryInstructions || "").trim(),
      paymentMethod: method,
      paymentStatus: prepaid ? "Paid" : "Pending",
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

    const projected = orders.map((order) => projectForUser(order, req.user));
    res.json(await withDriver(projected));
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

    const [projected] = await withDriver([projectForUser(order, req.user)]);
    res.json(projected);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/instructions  -  buyer updates delivery notes
// ---------------------------------------------------------------------------
router.patch("/:id/instructions", protect, requireRole("buyer"), async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (["Delivered", "Cancelled", "Rejected"].includes(order.status)) {
      return res.status(400).json({
        message: "This order is closed — delivery notes can no longer change.",
      });
    }

    order.deliveryInstructions = String(req.body.deliveryInstructions || "")
      .trim()
      .slice(0, 500);
    const updated = await order.save();

    res.json({
      message: "Delivery instructions saved",
      order: projectForUser(updated, req.user),
    });
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
      if (order.paymentStatus === "Paid") order.paymentStatus = "Refunded";
    }

    // Give the buyer a named delivery partner as soon as the order is live,
    // rather than leaving them with nobody to see until the van moves.
    if (["Accepted", "Confirmed"].includes(status) && !order.driverId) {
      try {
        const farmPlace =
          (order.products[0] && order.products[0].location) || order.deliveryAddress;
        const choice = await pickDriverFor(farmPlace);
        if (choice) {
          order.driverId = choice.driver._id;
          order.statusHistory.push({
            status,
            by: `auto-assigned ${choice.driver.name}`,
          });
        }
      } catch (assignError) {
        // A failure to assign must never block the farmer accepting an order;
        // the first driver to collect it will claim it instead.
        console.error("DRIVER ASSIGNMENT FAILED:", assignError.message);
      }
    }

    // The pool stays open: whoever actually collects the order owns it from
    // then on, even if a different partner was pencilled in.
    if (status === "In Transit" && req.user.role === "driver") {
      order.driverId = req.user._id;
    }

    // Cash is collected on delivery.
    if (status === "Delivered" && order.paymentStatus === "Pending") {
      order.paymentStatus = "Paid";
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
    if (order.paymentStatus === "Paid") order.paymentStatus = "Refunded";
    order.statusHistory.push({ status: "Cancelled", by: req.user.name });

    const updated = await order.save();

    res.json({ message: "Order cancelled successfully", order: updated });
  } catch (error) {
    console.error("CANCEL ORDER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id/tracking
//
// The whole journey for ONE order, for the parcel-tracking view: where it is
// collected from, where it is going, where the driver is right now, and how
// far along that is.
//
// Visible to the buyer who placed it, a farmer whose crop is in it, and the
// assigned driver - nobody else.
// ---------------------------------------------------------------------------
router.get("/:id/tracking", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await Order.findById(req.params.id).populate(
      "products.productId",
      "location cropName"
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const me = req.user;
    const isBuyer = String(order.buyerId) === String(me._id);
    const isFarmer = order.products.some(
      (line) => String(line.farmerId) === String(me._id)
    );
    const isDriver = order.driverId && String(order.driverId) === String(me._id);

    if (!isBuyer && !isFarmer && !isDriver) {
      return res.status(403).json({ message: "This is not your order." });
    }

    const firstLine = order.products[0];

    // --- the two ends of the journey ---------------------------------------
    const farmPlace =
      (firstLine && firstLine.productId && firstLine.productId.location) ||
      (firstLine && firstLine.location) ||
      "";
    const farmHit = geocode(farmPlace);
    const farmPoint =
      farmHit || approxNear(DEFAULT_DEPOT, hashSeed(`${order._id}-pickup`));

    const dropPlace = order.deliveryAddress || "";
    const dropHit = geocode(dropPlace);
    const dropPoint =
      dropHit || approxNear(DEFAULT_DEPOT, hashSeed(`${order._id}-dropoff`));

    const pickup = {
      lat: farmPoint.lat,
      lng: farmPoint.lng,
      label: `${(firstLine && firstLine.cropName) || "Produce"} farm`,
      place: farmPlace || "Farm location not recorded",
      farmerName: firstLine && firstLine.farmerName,
      approxLocation: !farmHit,
    };

    // The buyer's own address is only echoed back to people already entitled
    // to it - the buyer themselves, the farmer fulfilling it, and the driver.
    const dropoff = {
      lat: dropPoint.lat,
      lng: dropPoint.lng,
      label: "Delivery address",
      place: dropPlace || "No delivery address given",
      approxLocation: !dropHit,
    };

    const totalKm = haversineKm(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: dropoff.lat, lng: dropoff.lng }
    );

    // --- where the driver is, if they are sharing it -----------------------
    let driver = null;
    let progressPct = null;
    let remainingKm = null;
    let etaMinutes = null;

    const hasPing =
      order.driverLocation &&
      Number.isFinite(order.driverLocation.latitude) &&
      Number.isFinite(order.driverLocation.longitude);

    if (hasPing) {
      const at = { lat: order.driverLocation.latitude, lng: order.driverLocation.longitude };
      const fromPickup = haversineKm({ lat: pickup.lat, lng: pickup.lng }, at);
      const toDropoff = haversineKm(at, { lat: dropoff.lat, lng: dropoff.lng });

      // Share of the journey covered. Using both legs rather than the straight
      // pickup->driver distance keeps it sane when the driver detours.
      const covered = fromPickup + toDropoff;
      progressPct =
        covered > 0 ? Math.round(Math.min(100, Math.max(0, (fromPickup / covered) * 100))) : 0;
      remainingKm = Number(toDropoff.toFixed(2));
      etaMinutes = Math.round((toDropoff / 28) * 60); // same 28km/h the planner assumes

      driver = {
        lat: at.lat,
        lng: at.lng,
        updatedAt: order.driverLocation.updatedAt,
      };
    } else {
      // No live ping yet - fall back to what the status implies.
      progressPct =
        order.status === "Delivered" ? 100 : order.status === "In Transit" ? 50 : 0;
      remainingKm = Number(totalKm.toFixed(2));
      etaMinutes = Math.round((totalKm / 28) * 60);
    }

    // --- the stages the parcel moves through -------------------------------
    const reached = (statuses) => statuses.includes(order.status);
    const stages = [
      {
        key: "placed",
        label: "Order placed",
        done: true,
        at: order.createdAt,
      },
      {
        key: "accepted",
        label: "Accepted by farmer",
        done: reached(["Accepted", "Confirmed", "In Transit", "Delivered"]),
      },
      {
        key: "picked",
        label: `Collected from ${pickup.place}`,
        done: reached(["In Transit", "Delivered"]),
      },
      {
        key: "transit",
        label: "Out for delivery",
        done: reached(["In Transit", "Delivered"]),
        current: order.status === "In Transit",
      },
      {
        key: "delivered",
        label: `Delivered to ${dropoff.place}`,
        done: order.status === "Delivered",
      },
    ];

    for (const entry of order.statusHistory || []) {
      const stage = stages.find(
        (s) =>
          (s.key === "accepted" && ["Accepted", "Confirmed"].includes(entry.status)) ||
          (s.key === "transit" && entry.status === "In Transit") ||
          (s.key === "picked" && entry.status === "In Transit") ||
          (s.key === "delivered" && entry.status === "Delivered")
      );
      if (stage && !stage.at) stage.at = entry.at;
    }

    res.json({
      orderId: order._id,
      status: order.status,
      cancelled: ["Cancelled", "Rejected"].includes(order.status),
      // Who is bringing it, as soon as one is assigned.
      deliveryPartner: await driverCard(order.driverId),
      crop: firstLine && firstLine.cropName,
      items: order.products.map((line) => ({
        cropName: line.cropName,
        quantity: line.quantity,
        farmerName: line.farmerName,
      })),
      pickup,
      dropoff,
      driver,
      stages,
      straightLineKm: Number(totalKm.toFixed(2)),
      remainingKm,
      etaMinutes,
      progressPct,
      hasLiveLocation: !!hasPing,
      approximate: pickup.approxLocation || dropoff.approxLocation,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("ORDER TRACKING ERROR:", error);
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

    // Only the driver actually carrying this order may report its position -
    // otherwise any driver account could move the dot on someone else's
    // tracking map.
    if (!order.driverId || String(order.driverId) !== String(req.user._id)) {
      return res.status(403).json({
        message: "You are not the delivery partner for this order.",
      });
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
