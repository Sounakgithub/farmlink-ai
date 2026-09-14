const express = require("express");
const Order = require("../models/Order");
const {
  geocode,
  approxNear,
  hashSeed,
  DEFAULT_DEPOT,
} = require("../utils/geocode");
const { optimizeRoute, optimizePickupDelivery, haversineKm } = require("../utils/routeOptimizer");
const { protect, requireRole } = require("../middleware/auth");
const { roadRoute, pointFrom } = require("../utils/roadRouting");
const { quoteDelivery } = require("../utils/logistics");

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
//
// Builds the driver's run from real orders. Each order contributes TWO linked
// stops - collect at the farm, deliver to the address the buyer gave at
// checkout - and the planner keeps every pickup ahead of its own delivery.
//
// (This used to route to the farm only, so the delivery half of every journey
// was missing from both the distance and the map.)
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

    const jobs = orders.map((order) => {
      const firstLine = order.products && order.products[0];
      const short = `#${String(order._id).slice(-6).toUpperCase()}`;
      const crop = (firstLine && firstLine.cropName) || "Order";

      // --- pickup: the farm the crop is listed at -------------------------
      const farmPlace =
        (firstLine && firstLine.productId && firstLine.productId.location) ||
        (firstLine && firstLine.location) ||
        null;
      const farmHit = farmPlace ? geocode(farmPlace) : null;
      const farmPoint = farmHit || approxNear(startPoint, hashSeed(`${order._id}-pickup`));
      const pickupLabel = `Collect ${crop} ${short}`;
      if (!farmHit) approxStops.push(pickupLabel);

      // --- dropoff: where the buyer asked for it --------------------------
      const dropPlace = order.deliveryAddress || "";
      const dropHit = dropPlace ? geocode(dropPlace) : null;
      const dropPoint = dropHit || approxNear(startPoint, hashSeed(`${order._id}-dropoff`));
      const dropLabel = `Deliver ${crop} ${short}`;
      if (!dropHit) approxStops.push(dropLabel);

      return {
        orderId: order._id,
        crop,
        buyerName: order.buyerName,
        farmerName: firstLine && firstLine.farmerName,
        status: order.status,
        amount: order.totalAmount,
        pickup: {
          lat: farmPoint.lat,
          lng: farmPoint.lng,
          label: pickupLabel,
          place: farmPlace || "Unknown farm location",
          approxLocation: !farmHit,
        },
        dropoff: {
          lat: dropPoint.lat,
          lng: dropPoint.lng,
          label: dropLabel,
          place: dropPlace || "No delivery address given",
          approxLocation: !dropHit,
        },
      };
    });

    const plan = optimizePickupDelivery({
      start: startPoint,
      jobs,
      roundTrip,
      speedKmph: isFiniteNum(speedKmph) ? speedKmph : undefined,
    });

    res.json({ ...plan, approxStops, orderCount: orders.length });
  } catch (error) {
    console.error("ROUTE PLAN ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/routes/optimal
// Body: { from, to, weightKg?, needsRefrigeration? }
//   from / to: a place name, or { lat, lng }
//
// The shortest real road between two points - distance, drive time and the
// line to draw - from Google Distance Matrix or OSRM, falling back to a
// flagged straight-line estimate. With a weight it also prices the trip with
// every carrier that could take it and names the recommended one.
router.post("/optimal", protect, async (req, res) => {
  try {
    const { from, to, weightKg, needsRefrigeration } = req.body || {};

    const a = pointFrom(from);
    const b = pointFrom(to);
    if (!a || !b) {
      return res.status(422).json({
        message: !a ? "The starting point could not be located." : "The destination could not be located.",
      });
    }

    const route = await roadRoute(a, b);
    const straightKm = Math.round(haversineKm(a, b) * 10) / 10;

    const result = {
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      source: route.source,
      approximate: route.approximate,
      geometry: route.geometry,
      from: route.from,
      to: route.to,
      straightLineKm: straightKm,
      detourFactor: straightKm > 0 ? Math.round((route.distanceKm / straightKm) * 100) / 100 : null,
    };

    const weight = Number(weightKg);
    if (weightKg !== undefined && weightKg !== null && weightKg !== "") {
      if (!Number.isFinite(weight) || weight <= 0 || weight > 100000) {
        return res.status(400).json({ message: "Weight must be a positive number of kg." });
      }
      if (typeof from === "string" && typeof to === "string") {
        const quote = await quoteDelivery({
          lines: [{ location: from, quantity: weight }],
          dropPlace: to,
          needsRefrigeration: !!needsRefrigeration,
        });
        if (quote) {
          result.carriers = quote.options.map((o) => ({
            carrier: o.carrier,
            providerName: o.providerName,
            carrierRate: o.providerFee,
            liability: o.liability,
            refrigerated: o.refrigerated,
          }));
          result.suggestedCarrier = quote.best
            ? { carrier: quote.best.carrier, providerName: quote.best.providerName, carrierRate: quote.best.providerFee }
            : null;
        }
      } else {
        result.carriersNote = "Carrier pricing needs place names, since carriers declare coverage by city.";
      }
    }

    res.json(result);
  } catch (error) {
    console.error("OPTIMAL ROUTE ERROR:", error);
    res.status(500).json({ message: "Could not work out a route right now." });
  }
});

module.exports = router;
