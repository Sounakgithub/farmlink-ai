const PlatformSettings = require("../models/PlatformSettings");

/**
 * Read and update the single platform-settings document.
 *
 * Settings are read on almost every order, so they are cached briefly. Any
 * update invalidates the cache immediately, so an admin changing a fee sees it
 * take effect on the very next quote.
 */

const CACHE_MS = 30_000;
let cached = null;
let cachedAt = 0;

async function getSettings() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;

  let doc = await PlatformSettings.findOne({ key: "global" });
  if (!doc) {
    try {
      doc = await PlatformSettings.create({ key: "global" });
    } catch (error) {
      // Two requests racing to create it: the unique key means one lost.
      doc = await PlatformSettings.findOne({ key: "global" });
      if (!doc) throw error;
    }
  }

  cached = doc.toObject();
  cachedAt = Date.now();
  return cached;
}

// The fields an admin may change, and the bounds each must respect. Anything
// else in the request body is ignored rather than written.
const EDITABLE = {
  "fees.consumer.commissionPct": [0, 30],
  "fees.consumer.logisticsMarkupPct": [0, 50],
  "fees.business.commissionPct": [0, 30],
  "fees.business.logisticsMarkupPct": [0, 50],
  "independentRateCard.baseFee": [0, 5000],
  "independentRateCard.perKm": [0, 500],
  "independentRateCard.perKg": [0, 100],
  "independentRateCard.minFee": [0, 5000],
  "inspection.weightTolerancePct": [0, 50],
  "escrow.autoReleaseHours": [1, 720],
  "logistics.offerTtlMinutes": [1, 1440],
  "b2b.minLineQuantityKg": [1, 100000],
};
const EDITABLE_BOOLEANS = ["inspection.requirePickupInspection"];

function readPath(object, path) {
  return path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), object);
}

/**
 * Apply a partial update. Returns { settings, changes, errors }.
 * Nothing is saved if any provided value is out of bounds.
 */
async function updateSettings(patch = {}) {
  const current = await getSettings();
  const set = {};
  const changes = [];
  const errors = [];

  for (const [path, [min, max]] of Object.entries(EDITABLE)) {
    const value = readPath(patch, path);
    if (value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push(`${path} must be a number between ${min} and ${max}.`);
      continue;
    }
    if (readPath(current, path) !== n) {
      set[path] = n;
      changes.push({ path, from: readPath(current, path), to: n });
    }
  }

  for (const path of EDITABLE_BOOLEANS) {
    const value = readPath(patch, path);
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      errors.push(`${path} must be true or false.`);
      continue;
    }
    if (readPath(current, path) !== value) {
      set[path] = value;
      changes.push({ path, from: readPath(current, path), to: value });
    }
  }

  if (errors.length) return { settings: current, changes: [], errors };
  if (!changes.length) return { settings: current, changes, errors };

  await PlatformSettings.updateOne({ key: "global" }, { $set: set });
  invalidate();
  return { settings: await getSettings(), changes, errors };
}

function invalidate() {
  cached = null;
  cachedAt = 0;
}

/** The fee tier for a buyer. */
function tierFor(user) {
  return user && user.role === "buyer" && user.accountType === "business"
    ? "business"
    : "consumer";
}

module.exports = { getSettings, updateSettings, invalidate, tierFor, EDITABLE, EDITABLE_BOOLEANS };
