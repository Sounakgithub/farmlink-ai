// Step 2 of the matching pipeline: turn raw order rows into per-party
// behaviour profiles.
//
// Everything here is built from ONE aggregation per direction. The scorer then
// reads profiles out of a Map, so ranking 200 buyers still costs two database
// round-trips, not 200.

const mongoose = require("mongoose");
const Order = require("../../models/Order");
const Inspection = require("../../models/Inspection");

// Orders that prove the party actually follows through.
const COMPLETED = ["Delivered"];
// Orders that count against them.
const BROKEN = ["Cancelled", "Rejected"];
// Orders in flight - neither credit nor blame yet.
const LIVE = ["Pending", "Accepted", "Confirmed", "In Transit"];

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function emptyProfile() {
  return {
    orderCount: 0,
    completed: 0,
    broken: 0,
    live: 0,
    /** crop (lowercase) -> number of order lines */
    cropCounts: new Map(),
    totalLines: 0,
    typicalQuantityKg: null,
    typicalPricePerKg: null,
    lastOrderAt: null,
    isNewcomer: true,
  };
}

function finalise(draft) {
  return {
    orderCount: draft.orderCount,
    completed: draft.completed,
    broken: draft.broken,
    live: draft.live,
    cropCounts: draft.cropCounts,
    totalLines: draft.totalLines,
    typicalQuantityKg: median(draft._quantities),
    typicalPricePerKg: median(draft._prices),
    lastOrderAt: draft.lastOrderAt,
    isNewcomer: draft.orderCount === 0,
  };
}

function newDraft() {
  const d = emptyProfile();
  d._quantities = [];
  d._prices = [];
  return d;
}

function absorbOrder(draft, order, lines) {
  draft.orderCount += 1;
  if (COMPLETED.includes(order.status)) draft.completed += 1;
  else if (BROKEN.includes(order.status)) draft.broken += 1;
  else if (LIVE.includes(order.status)) draft.live += 1;

  if (!draft.lastOrderAt || order.createdAt > draft.lastOrderAt) {
    draft.lastOrderAt = order.createdAt;
  }

  for (const line of lines) {
    const crop = String(line.cropName || "").toLowerCase().trim();
    if (crop) {
      draft.cropCounts.set(crop, (draft.cropCounts.get(crop) || 0) + 1);
      draft.totalLines += 1;
    }
    if (Number.isFinite(line.quantity) && line.quantity > 0) {
      draft._quantities.push(line.quantity);
    }
    if (Number.isFinite(line.pricePerKg) && line.pricePerKg > 0) {
      draft._prices.push(line.pricePerKg);
    }
  }
}

/**
 * Buying behaviour for every buyer in `buyerIds`, in one query.
 * @returns {Promise<Map<string, object>>} buyerId (string) -> profile
 */
async function buildBuyerProfiles(buyerIds) {
  const profiles = new Map();
  const ids = (buyerIds || []).filter(Boolean);
  if (ids.length === 0) return profiles;

  const orders = await Order.find({ buyerId: { $in: ids } })
    .select("buyerId status createdAt products.cropName products.quantity products.pricePerKg")
    .lean();

  const drafts = new Map();
  for (const order of orders) {
    const key = String(order.buyerId);
    if (!drafts.has(key)) drafts.set(key, newDraft());
    absorbOrder(drafts.get(key), order, order.products || []);
  }

  // Everyone asked about gets a profile, even with no orders at all - the
  // scorer needs "newcomer" to be an explicit state, not a missing key.
  for (const id of ids) {
    const key = String(id);
    profiles.set(key, drafts.has(key) ? finalise(drafts.get(key)) : emptyProfile());
  }
  return profiles;
}

/**
 * Selling behaviour for every farmer in `farmerIds`, in one query.
 * Only the order lines belonging to that farmer are counted, so a multi-farmer
 * order does not credit all of them with the whole basket.
 */
async function buildFarmerProfiles(farmerIds) {
  const profiles = new Map();
  const ids = (farmerIds || []).filter(Boolean);
  if (ids.length === 0) return profiles;

  const orders = await Order.find({ "products.farmerId": { $in: ids } })
    .select("status createdAt products.farmerId products.cropName products.quantity products.pricePerKg")
    .lean();

  const wanted = new Set(ids.map(String));
  const drafts = new Map();

  for (const order of orders) {
    // Group this order's lines by the farmer they belong to.
    const byFarmer = new Map();
    for (const line of order.products || []) {
      const key = String(line.farmerId);
      if (!wanted.has(key)) continue;
      if (!byFarmer.has(key)) byFarmer.set(key, []);
      byFarmer.get(key).push(line);
    }
    for (const [key, lines] of byFarmer) {
      if (!drafts.has(key)) drafts.set(key, newDraft());
      absorbOrder(drafts.get(key), order, lines);
    }
  }

  // Produce quality: how this farmer's crops fared at independent pickup
  // inspections. One aggregation for every farmer on the page.
  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  const quality = await Inspection.aggregate([
    { $match: { stage: "pickup", farmerIds: { $in: objectIds } } },
    { $unwind: "$farmerIds" },
    { $match: { farmerIds: { $in: objectIds } } },
    {
      $group: {
        _id: "$farmerIds",
        inspected: { $sum: 1 },
        passed: { $sum: { $cond: [{ $eq: ["$result", "passed"] }, 1, 0] } },
      },
    },
  ]);
  const qualityByFarmer = new Map(quality.map((q) => [String(q._id), q]));

  for (const id of ids) {
    const key = String(id);
    const profile = drafts.has(key) ? finalise(drafts.get(key)) : emptyProfile();
    const q = qualityByFarmer.get(key);
    if (q) profile.quality = { inspected: q.inspected, passed: q.passed };
    profiles.set(key, profile);
  }
  return profiles;
}

/**
 * How much of this party's business is the given crop, 0..1.
 * Returns 0 when they have no history - the caller decides what that means.
 */
function cropShare(profile, cropName) {
  if (!profile || !profile.totalLines) return 0;
  const crop = String(cropName || "").toLowerCase().trim();
  return (profile.cropCounts.get(crop) || 0) / profile.totalLines;
}

function hasBought(profile, cropName) {
  if (!profile) return false;
  const crop = String(cropName || "").toLowerCase().trim();
  return (profile.cropCounts.get(crop) || 0) > 0;
}

/** Share of finished business that completed rather than fell through, 0..1. */
/** Share of pickup inspections passed, 0..1, or null with none on record. */
function qualityRate(profile) {
  if (!profile || !profile.quality || !profile.quality.inspected) return null;
  return profile.quality.passed / profile.quality.inspected;
}

function reliabilityRate(profile) {
  if (!profile) return null;
  const settled = profile.completed + profile.broken;
  if (settled === 0) return null; // nothing has finished yet
  return profile.completed / settled;
}

module.exports = {
  buildBuyerProfiles,
  buildFarmerProfiles,
  cropShare,
  hasBought,
  reliabilityRate,
  qualityRate,
  emptyProfile,
  median,
  COMPLETED,
  BROKEN,
  LIVE,
};
