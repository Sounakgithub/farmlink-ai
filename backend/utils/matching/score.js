// Step 3 of the matching pipeline: turn a (party, product) pair into a
// 0-100 match score.
//
// Design rules, all of them load-bearing:
//
// 1. GRADUAL, NOT BINARY. Every component is a continuous function of the
//    inputs. "Buyer wants 500kg, farmer has 400kg" is a good-but-not-perfect
//    match, and the number says so.
//
// 2. MISSING DATA IS NEUTRAL, NEVER ZERO. A brand-new buyer with no
//    preferences and no orders scores 60/100 - "Good", the honest middle -
//    rather than being buried at the bottom of every farmer's list. Each
//    component's neutral value is 60% of its weight, so they compose.
//
// 3. THE BREAKDOWN RECONCILES. Each component is rounded to 1dp and the final
//    score is the sum of those rounded parts, so breakdown.sum() === matchScore
//    exactly - no floating-point drift between what we show and what we rank on.

const { geocode } = require("../geocode");
const { cropShare, hasBought, reliabilityRate } = require("./history");

const WEIGHTS = {
  crop: 25,
  distance: 20,
  price: 20,
  quantity: 15,
  demand: 10,
  reliability: 10,
};

// 60% of each weight: what you score when we simply do not know.
const NEUTRAL = {
  crop: 15,
  distance: 12,
  price: 12,
  quantity: 9,
  demand: 6,
  reliability: 6,
};

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 100

// Loose crop families, used only for partial credit: a buyer who always buys
// spinach is a better prospect for cabbage than for rice, but not as good as
// one who buys cabbage already.
const CROP_FAMILIES = {
  leafy: ["spinach", "cabbage", "cauliflower", "lettuce", "methi", "coriander", "broccoli"],
  root: ["potato", "onion", "carrot", "radish", "beetroot", "garlic", "ginger", "turnip"],
  fruitveg: ["tomato", "brinjal", "eggplant", "cucumber", "capsicum", "pumpkin", "gourd", "chilli", "pepper", "okra", "ladyfinger"],
  legume: ["peas", "beans", "lentil", "chickpea", "gram"],
  grain: ["rice", "wheat", "maize", "corn", "millet", "bajra"],
  fruit: ["mango", "banana", "apple", "grape", "orange", "lemon", "coconut", "papaya"],
};

function familyOf(cropName) {
  const crop = String(cropName || "").toLowerCase().trim();
  if (!crop) return null;
  for (const [family, members] of Object.entries(CROP_FAMILIES)) {
    if (members.some((m) => crop.includes(m))) return family;
  }
  return null;
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const round1 = (value) => Math.round(value * 10) / 10;

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

// Same formula the delivery route optimiser uses.
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

const prefList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((v) => String(v || "").toLowerCase().trim())
    .filter(Boolean);

const isNum = (v) => Number.isFinite(v) && v !== null;

// ---------------------------------------------------------------------------
// 1. Crop compatibility - 25
// ---------------------------------------------------------------------------
function scoreCrop(cropName, prefs, profile) {
  const crop = String(cropName || "").toLowerCase().trim();
  const preferred = prefList(prefs && prefs.preferredCrops);
  const hasHistory = !!(profile && profile.totalLines > 0);

  if (crop && preferred.includes(crop)) {
    return { score: WEIGHTS.crop, basis: "stated-preference" };
  }

  if (hasBought(profile, crop)) {
    // 17..25, rising with how much of their business this crop is.
    const share = cropShare(profile, crop);
    return {
      score: clamp(17 + 8 * Math.min(1, share / 0.35), 17, WEIGHTS.crop),
      basis: "purchase-history",
      share,
    };
  }

  // Related crop, via stated preferences or past purchases.
  const family = familyOf(crop);
  if (family) {
    const relatedPreferred = preferred.some((c) => familyOf(c) === family);
    if (relatedPreferred) return { score: 14, basis: "related-preference" };

    if (hasHistory) {
      for (const bought of profile.cropCounts.keys()) {
        if (familyOf(bought) === family) {
          return { score: 12, basis: "related-history" };
        }
      }
    }
  }

  if (preferred.length > 0) {
    // They told us what they want and this is not it - a real signal, but we
    // still leave room above zero: stated preferences go stale.
    return { score: 6, basis: "outside-stated-preference" };
  }

  if (hasHistory) {
    return { score: 8, basis: "new-crop-for-this-buyer" };
  }

  return { score: NEUTRAL.crop, basis: "no-data" };
}

// ---------------------------------------------------------------------------
// 2. Distance / location - 20
//
// Uses real coordinates when the offline geocoder resolves both places. It
// never invents coordinates: an unknown place falls back to a name comparison
// and then to the neutral score, and the caller reports that as a limitation.
// ---------------------------------------------------------------------------
function scoreDistance(fromLocation, toLocation, prefs) {
  const a = geocode(fromLocation);
  const b = geocode(toLocation);

  const preferredLocations = prefList(prefs && prefs.preferredLocations);
  const toLower = String(toLocation || "").toLowerCase().trim();
  const fromLower = String(fromLocation || "").toLowerCase().trim();
  const locationIsPreferred =
    preferredLocations.length > 0 &&
    preferredLocations.some((p) => toLower.includes(p) || p.includes(toLower));

  if (a && b) {
    const km = haversineKm(a, b);
    // Rational decay rather than exponential, deliberately: an exponential
    // steep enough to separate neighbouring towns flattens out well before
    // the distances Indian logistics actually spans, leaving Delhi->Mumbai
    // and Delhi->Chennai scoring the same. This stays strictly decreasing
    // across the whole realistic range and never reaches zero:
    //   0km 20 | 30km 18.6 | 150km 14.5 | 500km 8.9 | 1150km 5.2 | 1800km 3.6
    let score = clamp(
      WEIGHTS.distance / (1 + km / 400),
      1.5,
      WEIGHTS.distance
    );
    if (locationIsPreferred) score = Math.max(score, 16);
    return { score, basis: "coordinates", km: Math.round(km) };
  }

  if (fromLower && toLower && fromLower === toLower) {
    // Same place by name - strong, but we cannot measure it.
    return { score: 18, basis: "same-location-name" };
  }

  if (locationIsPreferred) {
    return { score: 16, basis: "preferred-location" };
  }

  return { score: NEUTRAL.distance, basis: "unknown-location" };
}

// ---------------------------------------------------------------------------
// 3. Price / budget compatibility - 20
// ---------------------------------------------------------------------------
function scorePrice(pricePerKg, prefs, profile) {
  const price = Number(pricePerKg);
  if (!Number.isFinite(price) || price <= 0) {
    return { score: NEUTRAL.price, basis: "no-price" };
  }

  const min = prefs && isNum(prefs.minPricePerKg) ? Number(prefs.minPricePerKg) : null;
  const max = prefs && isNum(prefs.maxPricePerKg) ? Number(prefs.maxPricePerKg) : null;

  if (max !== null || min !== null) {
    const aboveMax = max !== null && price > max;
    const belowMin = min !== null && price < min;

    if (!aboveMax && !belowMin) {
      return { score: WEIGHTS.price, basis: "within-budget", min, max };
    }
    if (belowMin) {
      // Cheaper than they said they'd pay. Almost always welcome; the small
      // deduction just reflects that it is outside what they described.
      return { score: 17, basis: "below-stated-minimum", min };
    }
    // Over budget: fall away fast but never to zero.
    const over = price / max - 1;
    return {
      score: clamp(WEIGHTS.price - 60 * over, 3, 15),
      basis: "above-budget",
      max,
      overPct: Math.round(over * 100),
    };
  }

  const typical = profile && isNum(profile.typicalPricePerKg) ? profile.typicalPricePerKg : null;
  if (typical && typical > 0) {
    const ratio = price / typical;
    if (ratio <= 0.85) {
      return { score: WEIGHTS.price, basis: "cheaper-than-usual", typical, ratio };
    }
    if (ratio <= 1.15) {
      return { score: 18, basis: "around-usual-price", typical, ratio };
    }
    return {
      score: clamp(18 - 30 * (ratio - 1.15), 4, 18),
      basis: "above-usual-price",
      typical,
      ratio,
    };
  }

  return { score: NEUTRAL.price, basis: "no-budget-or-history" };
}

// ---------------------------------------------------------------------------
// 4. Quantity compatibility - 15
// ---------------------------------------------------------------------------
function scoreQuantity(availableKg, prefs, profile) {
  const available = Number(availableKg);

  if (!Number.isFinite(available) || available <= 0) {
    return { score: 0, basis: "out-of-stock" };
  }

  const target =
    prefs && isNum(prefs.preferredQuantityKg)
      ? Number(prefs.preferredQuantityKg)
      : profile && isNum(profile.typicalQuantityKg)
        ? profile.typicalQuantityKg
        : null;

  const minWanted = prefs && isNum(prefs.minQuantityKg) ? Number(prefs.minQuantityKg) : null;

  if (minWanted !== null && available < minWanted) {
    // Below the smallest lot they will take - capped low, not zeroed, because
    // a buyer will sometimes stretch for the right crop.
    return { score: 4, basis: "below-minimum-lot", available, minWanted };
  }

  if (target === null || target <= 0) {
    return { score: NEUTRAL.quantity, basis: "no-quantity-signal", available };
  }

  const ratio = available / target;
  if (ratio >= 1) {
    return { score: WEIGHTS.quantity, basis: "covers-requirement", available, target };
  }
  return {
    score: clamp(4 + 11 * ratio, 4, WEIGHTS.quantity),
    basis: "partial-requirement",
    available,
    target,
    coveragePct: Math.round(ratio * 100),
  };
}

// ---------------------------------------------------------------------------
// 5. Demand forecast - 10   (from the existing Flask ML service)
// ---------------------------------------------------------------------------
const DEMAND_LEVEL_SCORE = {
  High: 10,
  "Medium-High": 8.5,
  Medium: 7,
  "Medium-Low": 5,
  Low: 3.5,
};

function scoreDemand(mlEntry) {
  if (!mlEntry || !DEMAND_LEVEL_SCORE[mlEntry.level]) {
    // ML offline, or it has never heard of this crop/city.
    return { score: NEUTRAL.demand, basis: mlEntry ? "unknown-crop" : "forecast-unavailable" };
  }

  const base = DEMAND_LEVEL_SCORE[mlEntry.level];
  // A rising trend nudges it up, a falling one down - capped so the trend can
  // never outweigh the level itself.
  const trendAdjust = clamp((mlEntry.trendPct || 0) / 20, -1.5, 1.5);

  return {
    score: clamp(base + trendAdjust, 0, WEIGHTS.demand),
    basis: "forecast",
    level: mlEntry.level,
    trendPct: mlEntry.trendPct,
  };
}

// ---------------------------------------------------------------------------
// 6. Transaction / reliability history - 10
// ---------------------------------------------------------------------------
function scoreReliability(profile) {
  if (!profile || profile.orderCount === 0) {
    return { score: NEUTRAL.reliability, basis: "newcomer" };
  }

  const rate = reliabilityRate(profile);
  if (rate === null) {
    // Orders placed but none finished either way yet.
    return { score: 6.5, basis: "orders-in-flight", live: profile.live };
  }

  const settled = profile.completed + profile.broken;
  // 3 base + up to 6 for the completion rate + up to 1 for having enough
  // finished orders to trust the rate at all.
  const confidence = Math.min(1, settled / 5);
  return {
    score: clamp(3 + 6 * rate + confidence, 0, WEIGHTS.reliability),
    basis: "track-record",
    completed: profile.completed,
    broken: profile.broken,
    ratePct: Math.round(rate * 100),
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
function qualityFor(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Good";
  if (score >= 40) return "Possible";
  return "Weak";
}

/**
 * Score one pairing.
 *
 * @param {object} input
 *   cropName, pricePerKg, availableKg, productLocation - the listing
 *   counterpartyLocation - where the other side is
 *   prefs    - buyer preferences ({} when none)
 *   profile  - buyer behaviour profile (crop/price/quantity signals)
 *   reliabilityProfile - whose track record to judge (buyer or farmer)
 *   demand   - one entry from mlClient.demandInsights(), or null
 */
function scoreMatch({
  cropName,
  pricePerKg,
  availableKg,
  productLocation,
  counterpartyLocation,
  prefs = {},
  profile = null,
  reliabilityProfile = null,
  demand = null,
}) {
  const parts = {
    crop: scoreCrop(cropName, prefs, profile),
    distance: scoreDistance(productLocation, counterpartyLocation, prefs),
    price: scorePrice(pricePerKg, prefs, profile),
    quantity: scoreQuantity(availableKg, prefs, profile),
    demand: scoreDemand(demand),
    reliability: scoreReliability(reliabilityProfile || profile),
  };

  // Round each part FIRST, then sum the rounded parts. This is what makes the
  // published breakdown add up to the published score exactly.
  const breakdown = {};
  let total = 0;
  for (const [key, part] of Object.entries(parts)) {
    const value = round1(clamp(part.score, 0, WEIGHTS[key]));
    breakdown[key] = { score: value, max: WEIGHTS[key], basis: part.basis };
    total += value;
  }

  const matchScore = round1(total);

  return {
    matchScore,
    matchQuality: qualityFor(matchScore),
    scoreBreakdown: breakdown,
    // Kept for the explanation layer; not part of the arithmetic.
    details: parts,
  };
}

module.exports = {
  scoreMatch,
  scoreCrop,
  scoreDistance,
  scorePrice,
  scoreQuantity,
  scoreDemand,
  scoreReliability,
  qualityFor,
  haversineKm,
  familyOf,
  round1,
  WEIGHTS,
  NEUTRAL,
  TOTAL_WEIGHT,
};
