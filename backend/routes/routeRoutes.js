const express = require("express");
const Order = require("../models/Order");
const {
  geocode,
  approxNear,
  hashSeed,
  DEFAULT_DEPOT,
} = require("../utils/geocode");
const { optimizeRoute } = require("../utils/routeOptimizer");
const { protect, requireRole } = require("../middleware/auth");

const router = express.Router();

const ACTIVE_STATUSES = ["Accepted", "Confirmed", "In Transit"];

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Resolve a point that may be given as { lat, lng } or { location: "Delhi" }.
// Falls back to a deterministic point near `anchor` when unresolvable.
function resolvePoint(input, anchor, seed) {
  if (input && isFiniteNum(input.lat) && isFiniteNum(input.lng)) {
    return { lat: input.lat, lng: input.lng, label: input.label, resolved: true };
  }
  const name = input && (input.location || input.city || input.label);
  const hit = name ? geocode(name) : null;
  if (hit) {
    return { ...hit, label: input.label || name, resolved: true };
  }
  if (anchor) {
    return {
      ...approxNear(anchor, seed),
      label: (input && (input.label || input.location)) || "Approx location",
      resolved: false,
      approx: true,
    };
  }
  return null;
}

// POST /api/routes/optimize
// Body: { start, stops: [...], roundTrip?, speedKmph?, serviceMinutesPerStop? }
router.post("/optimize", (req, res) => {
  try {
    const {
      start,
      stops = [],
      roundTrip = false,
      speedKmph,
      serviceMinutesPerStop,
    } = req.body || {};

    const startPoint = resolvePoint(start) || { ...DEFAULT_DEPOT, resolved: true };

    if (!Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({ message: "Provide at least one delivery stop." });
    }

    const approxStops = [];
    const resolvedStops = stops.map((stop, index) => {
      const point = resolvePoint(stop, startPoint, index + 1);
      if (point.approx) approxStops.push(point.label);
      return {
        ...stop,
        lat: point.lat,
        lng: point.lng,
        label: stop.label || point.label,
        approxLocation: !!point.approx,
      };
    });

    const plan = optimizeRoute({
      start: startPoint,
      stops: resolvedStops,
      roundTrip,
      speedKmph: isFiniteNum(speedKmph) ? speedKmph : undefined,
      serviceMinutesPerStop: isFiniteNum(serviceMinutesPerStop)
        ? serviceMinutesPerStop
        : undefined,
    });

    res.json({ ...plan, approxStops });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/routes/optimize-orders
// Body: { start?, orderIds?, statuses?, roundTrip? }
// Builds delivery stops from real orders (stop location = first product's
// farm location) and returns the optimised driver route.
router.post("/optimize-orders", protect, requireRole("driver"), async (req, res) => {
  try {
    const {
      start,
      orderIds,
      statuses,
      roundTrip = true,
      speedKmph,
    } = req.body || {};

    const startPoint = resolvePoint(start) || { ...DEFAULT_DEPOT, resolved: true };

    const filter = {};
    if (Array.isArray(orderIds) && orderIds.length > 0) {
      filter._id = { $in: orderIds };
    } else {
      filter.status = {
        $in: Array.isArray(statuses) && statuses.length ? statuses : ACTIVE_STATUSES,
      };
    }

    const orders = await Order.find(filter)
      .populate("products.productId", "location cropName")
      .sort({ createdAt: 1 });

    if (orders.length === 0) {
      return res.status(404).json({
        message: "No matching orders to route.",
        filterUsed: filter,
      });
    }

    const approxStops = [];
    const stops = orders.map((order) => {
      const firstProduct = order.products && order.products[0];
      const location =
        (firstProduct &&
          firstProduct.productId &&
          firstProduct.productId.location) ||
        null;

      const hit = location ? geocode(location) : null;
      const point = hit || approxNear(startPoint, hashSeed(order._id));
      const label = `${
        (firstProduct && firstProduct.cropName) || "Order"
      } · #${String(order._id).slice(-6).toUpperCase()}`;

      if (!hit) approxStops.push(label);

      return {
        orderId: order._id,
        label,
        crop: firstProduct && firstProduct.cropName,
        buyerName: order.buyerName,
        location: location || "Unknown",
        status: order.status,
        amount: order.totalAmount,
        lat: point.lat,
        lng: point.lng,
        approxLocation: !hit,
      };
    });

    const plan = optimizeRoute({
      start: startPoint,
      stops,
      roundTrip,
      speedKmph: isFiniteNum(speedKmph) ? speedKmph : undefined,
    });

    res.json({ ...plan, approxStops, orderCount: orders.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
