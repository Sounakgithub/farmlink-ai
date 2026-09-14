// Picking a delivery partner for an order.
//
// Until now a driver only became attached to an order at the moment they
// pressed "Collected" - so between the farmer accepting and the van actually
// moving, the buyer had nobody to see and nobody to call.
//
// This assigns one as soon as the farmer accepts, choosing the driver who is
// closest to the farm and least loaded. The delivery pool stays open: if a
// different driver physically picks the order up, the order follows reality
// and re-points to them. The assignment is a sensible default, not a lock.

const User = require("../models/User");
const Order = require("../models/Order");
const { geocode } = require("./geocode");
const { haversineKm } = require("./routeOptimizer");

// Orders that still occupy a driver's day.
const LIVE_STATUSES = ["Accepted", "Confirmed", "In Transit"];

// How much one active order counts against a driver, expressed in km of
// detour. A driver 20km further away but with nothing on is the better pick
// than a nearer one already juggling three drops.
const LOAD_PENALTY_KM = 25;

// When we cannot place a driver on the map we neither reject them nor pretend
// they are nearby: they sit at a fixed, clearly-worse-than-known distance so a
// locatable driver always wins, but an unlocatable one can still be assigned
// when they are all we have.
const UNKNOWN_DISTANCE_KM = 400;

/**
 * Choose the best delivery partner for a pickup location.
 *
 * @param {string} pickupPlace  the farm's location text
 * @returns {Promise<{driver: object, distanceKm: number|null, activeOrders: number}|null>}
 *          null when there is no driver on the platform at all.
 */
async function pickDriverFor(pickupPlace) {
  // Drivers who belong to a logistics company take work through it, not
  // from the independent pool.
  const drivers = await User.find({ role: "driver", providerId: null }).select("name phone location createdAt");
  if (drivers.length === 0) return null;

  // One query for everyone's workload rather than one per driver.
  const loads = await Order.aggregate([
    { $match: { status: { $in: LIVE_STATUSES }, driverId: { $ne: null } } },
    { $group: { _id: "$driverId", count: { $sum: 1 } } },
  ]);
  const loadByDriver = new Map(loads.map((row) => [String(row._id), row.count]));

  const farm = geocode(pickupPlace);

  let best = null;

  for (const driver of drivers) {
    const here = geocode(driver.location);
    const distanceKm = farm && here ? haversineKm(farm, here) : null;
    const activeOrders = loadByDriver.get(String(driver._id)) || 0;

    // Lower is better.
    const cost =
      (distanceKm === null ? UNKNOWN_DISTANCE_KM : distanceKm) +
      activeOrders * LOAD_PENALTY_KM;

    if (!best || cost < best.cost) {
      best = { driver, distanceKm, activeOrders, cost };
    }
  }

  if (!best) return null;

  return {
    driver: best.driver,
    distanceKm: best.distanceKm === null ? null : Number(best.distanceKm.toFixed(1)),
    activeOrders: best.activeOrders,
  };
}

/**
 * The delivery-partner card a buyer is allowed to see.
 *
 * Name, phone and city only - the things you need to take a delivery. Never
 * the email address or anything else off the account.
 */
async function driverCard(driverId) {
  if (!driverId) return null;

  const driver = await User.findById(driverId).select("name phone location createdAt");
  if (!driver) return null;

  const completed = await Order.countDocuments({
    driverId: driver._id,
    status: "Delivered",
  });

  return {
    id: driver._id,
    name: driver.name,
    phone: driver.phone || "",
    location: driver.location || "",
    completedDeliveries: completed,
    partnerSince: driver.createdAt,
  };
}

module.exports = { pickDriverFor, driverCard, LIVE_STATUSES };
