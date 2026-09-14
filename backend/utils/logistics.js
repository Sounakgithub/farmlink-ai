const LogisticsProvider = require("../models/LogisticsProvider");
const LogisticsAssignment = require("../models/LogisticsAssignment");
const User = require("../models/User");
const { roadRoute } = require("./roadRouting");
const { rateCardFee } = require("./fees");
const { getSettings } = require("./settings");
const { pickDriverFor } = require("./driverAssignment");
const { audit } = require("./audit");

/**
 * Third-party logistics: who can carry a delivery, what it costs, and how the
 * job is offered.
 *
 * Pricing is locked at checkout. The buyer is quoted from the cheapest
 * eligible verified carrier when one covers the route - carriers publish
 * damage-liability cover that an independent driver does not, so they are
 * preferred - and from the independent rate card otherwise. That fixes what
 * the job pays. When the farmer accepts, carriers are
 * offered the job at that locked payout in rank order. A carrier whose own
 * rate card would charge more than the job pays is skipped - it would only
 * decline. If no carrier takes it, FarmLink's independent delivery partners do.
 */

const httpError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const norm = (text) => String(text || "").trim().toLowerCase();

/** Does a carrier's coverage include this place? Matches "Sector 45, Gurgaon". */
function covers(provider, place) {
  const target = norm(place);
  if (!target) return false;
  return (provider.coverageCities || []).some((city) => {
    const c = norm(city);
    return c && (target === c || target.includes(c));
  });
}

/** The distinct farm locations an order collects from, in line order. */
function pickupPlaces(lines) {
  return [...new Set(lines.map((l) => l.location).filter(Boolean))];
}

const weightOf = (lines) =>
  lines.reduce((total, line) => total + (Number(line.quantity) || 0), 0);

/**
 * Road distance for the whole run: every farm in turn, then the door.
 * Multi-farm orders are priced on the real multi-stop distance, not just the
 * first farm.
 */
async function journey(lines, dropPlace, coordinates = {}) {
  const pickups = pickupPlaces(lines);
  if (pickups.length === 0 || !dropPlace) return null;

  const stops = [
    ...pickups.map((place, i) =>
      i === 0 && coordinates.pickup ? { coordinates: coordinates.pickup, location: place } : place
    ),
    coordinates.drop ? { coordinates: coordinates.drop, location: dropPlace } : dropPlace,
  ];

  let distanceKm = 0;
  let durationMin = 0;
  let approximate = false;
  const sources = new Set();
  const geometry = [];

  for (let i = 0; i < stops.length - 1; i++) {
    const leg = await roadRoute(stops[i], stops[i + 1]);
    if (!leg) return null; // a place we cannot locate at all
    distanceKm += leg.distanceKm;
    durationMin += leg.durationMin;
    approximate = approximate || leg.approximate;
    sources.add(leg.source);
    geometry.push(...(leg.geometry || []));
  }

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin,
    approximate,
    source: [...sources].join("+"),
    geometry,
    stops: stops.length,
  };
}

/** Verified, active carriers able to take this job. */
async function eligibleProviders({ pickups, dropPlace, weightKg, needsRefrigeration }) {
  const candidates = await LogisticsProvider.find({ active: true, verified: true });
  return candidates.filter(
    (provider) =>
      pickups.every((place) => covers(provider, place)) &&
      covers(provider, dropPlace) &&
      (provider.maxLoadKg || 0) >= weightKg &&
      (!needsRefrigeration || provider.refrigerated)
  );
}

/**
 * Every way this delivery could be carried, cheapest first.
 *
 * @returns {Promise<{route, weightKg, options, best}|null>}
 *   null when a place cannot be located, so no honest quote exists.
 */
async function quoteDelivery({ lines, dropPlace, needsRefrigeration = false, coordinates = {} }) {
  const route = await journey(lines, dropPlace, coordinates);
  if (!route) return null;

  const settings = await getSettings();
  const weightKg = weightOf(lines);
  const pickups = pickupPlaces(lines);

  const providers = await eligibleProviders({ pickups, dropPlace, weightKg, needsRefrigeration });

  const options = providers
    .map((provider) => ({
      carrier: "provider",
      providerId: provider._id,
      providerName: provider.name,
      providerFee: rateCardFee(provider.rateCard, route.distanceKm, weightKg),
      liability: provider.liability,
      refrigerated: provider.refrigerated,
    }))
    .sort((a, b) => a.providerFee - b.providerFee);

  // Independent partners are always an option unless the load needs chilling.
  if (!needsRefrigeration) {
    options.push({
      carrier: "independent",
      providerId: null,
      providerName: "FarmLink delivery partner",
      providerFee: rateCardFee(settings.independentRateCard, route.distanceKm, weightKg),
      liability: null,
      refrigerated: false,
    });
  }

  options.sort((a, b) => a.providerFee - b.providerFee);

  // Liability-covered carriers first; independent partners as the fallback.
  const best =
    options.find((o) => o.carrier === "provider") ||
    options.find((o) => o.carrier === "independent") ||
    null;

  return {
    route,
    weightKg,
    needsRefrigeration,
    options,
    best,
  };
}

// ===========================================================================
// Offers
// ===========================================================================

/**
 * Offer the job to the next carrier in line, or fall back to an independent
 * driver. Mutates the order (logistics, driverId); the caller saves it.
 */
async function dispatch(order, req) {
  const settings = await getSettings();
  const lockedPayout = Number(order.charges?.logisticsPayout) || 0;
  const weightKg = weightOf(order.products);
  const pickups = pickupPlaces(order.products);
  const distanceKm = Number(order.charges?.quote?.distanceKm) || 0;

  const tried = await LogisticsAssignment.find({ orderId: order._id }).select("providerId");
  const triedIds = new Set(tried.map((a) => String(a.providerId)));

  const providers = await eligibleProviders({
    pickups,
    dropPlace: order.deliveryAddress,
    weightKg,
    needsRefrigeration: !!order.charges?.quote?.needsRefrigeration,
  });

  const ranked = providers
    .filter((p) => !triedIds.has(String(p._id)))
    .map((p) => ({ provider: p, ownFee: rateCardFee(p.rateCard, distanceKm, weightKg) }))
    // Skip carriers the job does not pay enough for - they would only decline.
    .filter((entry) => lockedPayout > 0 && entry.ownFee <= lockedPayout)
    .sort((a, b) => a.ownFee - b.ownFee);

  const next = ranked[0];

  if (next) {
    const assignment = await LogisticsAssignment.create({
      orderId: order._id,
      providerId: next.provider._id,
      status: "offered",
      rank: triedIds.size + 1,
      quote: {
        distanceKm,
        durationMin: order.charges?.quote?.durationMin,
        weightKg,
        providerFee: lockedPayout,
        routeSource: order.charges?.quote?.routeSource,
      },
      liability: {
        coveragePct: next.provider.liability?.coveragePct,
        maxPerOrder: next.provider.liability?.maxPerOrder,
      },
      expiresAt: new Date(Date.now() + settings.logistics.offerTtlMinutes * 60e3),
    });

    await LogisticsProvider.updateOne({ _id: next.provider._id }, { $inc: { "stats.offered": 1 } });

    order.logistics = {
      ...(order.logistics?.toObject ? order.logistics.toObject() : order.logistics || {}),
      mode: "offered",
      providerId: next.provider._id,
      providerName: next.provider.name,
      assignmentId: assignment._id,
      offersMade: (order.logistics?.offersMade || 0) + 1,
    };

    await audit(req, "logistics.offered", "Order", order._id, {
      providerId: next.provider._id,
      providerName: next.provider.name,
      payout: lockedPayout,
      rank: assignment.rank,
    });

    return { mode: "offered", assignment, provider: next.provider };
  }

  // No carrier left: the independent pool takes it, exactly as before 3PL.
  const farmPlace = pickups[0] || order.deliveryAddress;
  let driver = null;
  try {
    const choice = await pickDriverFor(farmPlace);
    driver = choice ? choice.driver : null;
  } catch (error) {
    console.error("INDEPENDENT DRIVER ASSIGNMENT FAILED:", error.message);
  }

  order.logistics = {
    ...(order.logistics?.toObject ? order.logistics.toObject() : order.logistics || {}),
    mode: "independent",
    providerId: undefined,
    providerName: undefined,
    assignmentId: undefined,
    liability: undefined,
  };
  if (driver && !order.driverId) {
    order.driverId = driver._id;
    order.statusHistory.push({ status: order.status, by: `auto-assigned ${driver.name}` });
  }

  await audit(req, "logistics.independent", "Order", order._id, {
    driverId: driver?._id || null,
    carriersTried: triedIds.size,
  });

  return { mode: "independent", driver };
}

/** A carrier accepts, naming the driver who will run it. Saves both. */
async function acceptOffer(assignment, provider, driverId, req) {
  if (assignment.status !== "offered") {
    throw httpError(409, `This offer is ${assignment.status}, not open.`);
  }
  if (assignment.expiresAt <= new Date()) {
    throw httpError(409, "This offer has expired.");
  }

  const driver = await User.findOne({ _id: driverId, role: "driver", providerId: provider._id });
  if (!driver) {
    throw httpError(400, "Choose one of your own drivers to run this delivery.");
  }

  const Order = require("../models/Order");
  const order = await Order.findById(assignment.orderId);
  if (!order || !["Accepted", "Confirmed"].includes(order.status)) {
    assignment.status = "cancelled";
    await assignment.save();
    throw httpError(409, "This order is no longer waiting for a carrier.");
  }

  assignment.status = "accepted";
  assignment.driverId = driver._id;
  assignment.respondedAt = new Date();
  await assignment.save();

  order.driverId = driver._id;
  order.logistics = {
    ...(order.logistics?.toObject ? order.logistics.toObject() : order.logistics || {}),
    mode: "provider",
    providerId: provider._id,
    providerName: provider.name,
    assignmentId: assignment._id,
    liability: assignment.liability,
  };
  order.statusHistory.push({ status: order.status, by: `${provider.name} assigned ${driver.name}` });
  await order.save();

  await LogisticsProvider.updateOne({ _id: provider._id }, { $inc: { "stats.accepted": 1 } });
  await audit(req, "logistics.accepted", "Order", order._id, {
    providerId: provider._id,
    driverId: driver._id,
    assignmentId: assignment._id,
  });

  return { order, assignment, driver };
}

/** A carrier declines; the job moves on. Saves both. */
async function rejectOffer(assignment, provider, reason, req) {
  if (assignment.status !== "offered") {
    throw httpError(409, `This offer is ${assignment.status}, not open.`);
  }

  assignment.status = "rejected";
  assignment.reason = String(reason || "").slice(0, 300);
  assignment.respondedAt = new Date();
  await assignment.save();
  await LogisticsProvider.updateOne({ _id: provider._id }, { $inc: { "stats.rejected": 1 } });

  const Order = require("../models/Order");
  const order = await Order.findById(assignment.orderId);
  await audit(req, "logistics.rejected", "Order", assignment.orderId, {
    providerId: provider._id,
    reason: assignment.reason,
  });

  if (!order || !["Accepted", "Confirmed"].includes(order.status)) return { order, next: null };

  const next = await dispatch(order, req);
  await order.save();
  return { order, next };
}

/** Offers nobody answered in time move on. Run on a timer. */
async function sweepExpiredOffers() {
  const Order = require("../models/Order");
  const stale = await LogisticsAssignment.find({
    status: "offered",
    expiresAt: { $lte: new Date() },
  }).limit(100);

  let moved = 0;
  for (const assignment of stale) {
    assignment.status = "expired";
    assignment.respondedAt = new Date();
    await assignment.save();

    const order = await Order.findById(assignment.orderId);
    if (order && ["Accepted", "Confirmed"].includes(order.status) && order.logistics?.mode === "offered") {
      await dispatch(order, null);
      await order.save();
      moved += 1;
    }
  }
  return moved;
}

module.exports = {
  covers,
  pickupPlaces,
  weightOf,
  journey,
  eligibleProviders,
  quoteDelivery,
  dispatch,
  acceptOffer,
  rejectOffer,
  sweepExpiredOffers,
};
