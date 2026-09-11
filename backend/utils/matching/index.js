// The AI matching engine: an explainable recommendation layer that sits on
// top of the existing marketplace without replacing any of it.
//
// Two directions, one scorer:
//
//   farmer -> buyers    "who should I sell this crop to?"
//   buyer  -> products  "what should I buy, and from whom?"
//
// The pipeline is deliberately linear and each stage is its own module:
//
//   retrieval (here) -> history.js -> score.js -> ranking (here) -> explain.js
//
// Query budget is fixed, not proportional to the number of candidates: each
// direction issues a constant number of database round-trips plus at most one
// call to the ML service, however many buyers or products are in play.

const User = require("../../models/User");
const Product = require("../../models/Product");
const { buildBuyerProfiles, buildFarmerProfiles } = require("./history");
const { scoreMatch } = require("./score");
const { explain } = require("./explain");
const mlClient = require("../mlClient");

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
// Upper bound on how many candidates we score in one request. Scoring is pure
// arithmetic (microseconds each), so this is about bounding the database read,
// not the CPU.
const MAX_CANDIDATES = 300;

function normaliseLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function plainPrefs(user) {
  if (!user || !user.buyerPreferences) return {};
  const prefs = user.buyerPreferences;
  return typeof prefs.toObject === "function" ? prefs.toObject() : prefs;
}

// Ranking: score first, then deterministic tie-breakers so the same data
// always produces the same order (otherwise pagination and tests wobble).
function rankMatches(matches) {
  return matches.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    const aCrop = a.scoreBreakdown.crop.score;
    const bCrop = b.scoreBreakdown.crop.score;
    if (bCrop !== aCrop) return bCrop - aCrop;
    return String(a.id).localeCompare(String(b.id));
  });
}

// ---------------------------------------------------------------------------
// Direction 1: farmer's product -> the buyers most likely to want it
// ---------------------------------------------------------------------------
async function matchBuyersForProduct(product, { limit } = {}) {
  const take = normaliseLimit(limit);

  // --- retrieval: every buyer, plus their order history, in two queries ----
  const buyers = await User.find({ role: "buyer" })
    .select("name role location buyerPreferences createdAt")
    .limit(MAX_CANDIDATES);

  if (buyers.length === 0) {
    return { matches: [], candidatesConsidered: 0, mlAvailable: null };
  }

  const buyerIds = buyers.map((b) => b._id);
  const profiles = await buildBuyerProfiles(buyerIds);

  // --- one ML call for the whole page -------------------------------------
  const demandByCrop = await mlClient.demandInsights(product.location, [product.cropName]);
  const demandEntry = demandByCrop.get(String(product.cropName).toLowerCase()) || null;
  const mlAvailable = demandByCrop.size > 0;

  // --- scoring ------------------------------------------------------------
  const matches = buyers.map((buyer) => {
    const profile = profiles.get(String(buyer._id)) || null;
    const prefs = plainPrefs(buyer);

    const scored = scoreMatch({
      cropName: product.cropName,
      pricePerKg: product.pricePerKg,
      availableKg: product.quantity,
      productLocation: product.location,
      counterpartyLocation: buyer.location,
      prefs,
      profile,
      reliabilityProfile: profile, // judging the buyer's own track record
      demand: demandEntry,
    });

    const { reasons, limitations, summary } = explain(scored, {
      cropName: product.cropName,
      direction: "buyers",
      productLocation: product.location,
      counterpartyLocation: buyer.location,
    });

    return {
      id: String(buyer._id),
      // Privacy: name + city only. No email, no phone, no addresses.
      buyer: buyer.toPublicCard(),
      matchScore: scored.matchScore,
      matchQuality: scored.matchQuality,
      scoreBreakdown: scored.scoreBreakdown,
      reasons,
      limitations,
      summary,
      distanceKm: scored.details.distance.km ?? null,
      history: {
        orders: profile ? profile.orderCount : 0,
        completed: profile ? profile.completed : 0,
        typicalQuantityKg: profile ? profile.typicalQuantityKg : null,
        boughtThisCropBefore: !!(
          profile && profile.cropCounts.get(String(product.cropName).toLowerCase())
        ),
        isNewcomer: profile ? profile.isNewcomer : true,
      },
    };
  });

  return {
    matches: rankMatches(matches).slice(0, take),
    candidatesConsidered: buyers.length,
    mlAvailable,
  };
}

// ---------------------------------------------------------------------------
// Direction 2: buyer -> the crops and farmers that suit them
// ---------------------------------------------------------------------------
async function recommendProductsForBuyer(buyer, { limit, includeOutOfStock = false } = {}) {
  const take = normaliseLimit(limit);

  const filter = includeOutOfStock ? {} : { quantity: { $gt: 0 } };

  // --- retrieval ----------------------------------------------------------
  const products = await Product.find(filter)
    .select("farmerId farmerName cropName quantity unit location pricePerKg image createdAt")
    .sort({ createdAt: -1 })
    .limit(MAX_CANDIDATES)
    .lean();

  if (products.length === 0) {
    return { matches: [], candidatesConsidered: 0, mlAvailable: null };
  }

  // The buyer's own behaviour, and every listed farmer's track record.
  const farmerIds = [...new Set(products.map((p) => String(p.farmerId)))];
  const [buyerProfiles, farmerProfiles] = await Promise.all([
    buildBuyerProfiles([buyer._id]),
    buildFarmerProfiles(farmerIds),
  ]);

  const profile = buyerProfiles.get(String(buyer._id)) || null;
  const prefs = plainPrefs(buyer);

  // --- one ML call covering every distinct crop on the page ---------------
  const crops = [...new Set(products.map((p) => p.cropName))];
  const demandLocation = buyer.location || products[0].location;
  const demandByCrop = await mlClient.demandInsights(demandLocation, crops);
  const mlAvailable = demandByCrop.size > 0;

  // --- scoring ------------------------------------------------------------
  const matches = products.map((product) => {
    const farmerProfile = farmerProfiles.get(String(product.farmerId)) || null;
    const demandEntry = demandByCrop.get(String(product.cropName).toLowerCase()) || null;

    const scored = scoreMatch({
      cropName: product.cropName,
      pricePerKg: product.pricePerKg,
      availableKg: product.quantity,
      productLocation: product.location,
      counterpartyLocation: buyer.location,
      prefs,
      profile, // the buyer's own crop/price/quantity signals
      reliabilityProfile: farmerProfile, // but the farmer's track record
      demand: demandEntry,
    });

    const { reasons, limitations, summary } = explain(scored, {
      cropName: product.cropName,
      direction: "products",
      productLocation: product.location,
      counterpartyLocation: buyer.location,
    });

    return {
      id: String(product._id),
      // Already-public marketplace fields only.
      product: {
        _id: product._id,
        cropName: product.cropName,
        quantity: product.quantity,
        unit: product.unit,
        location: product.location,
        pricePerKg: product.pricePerKg,
        image: product.image,
        farmerId: product.farmerId,
        farmerName: product.farmerName,
        inStock: product.quantity > 0,
      },
      matchScore: scored.matchScore,
      matchQuality: scored.matchQuality,
      scoreBreakdown: scored.scoreBreakdown,
      reasons,
      limitations,
      summary,
      distanceKm: scored.details.distance.km ?? null,
      farmer: {
        id: product.farmerId,
        name: product.farmerName,
        completedOrders: farmerProfile ? farmerProfile.completed : 0,
        isNewcomer: farmerProfile ? farmerProfile.isNewcomer : true,
      },
    };
  });

  return {
    matches: rankMatches(matches).slice(0, take),
    candidatesConsidered: products.length,
    mlAvailable,
    buyerHasHistory: !!(profile && profile.orderCount > 0),
    buyerHasPreferences: Object.keys(prefs).some((key) => {
      const value = prefs[key];
      return Array.isArray(value) ? value.length > 0 : value !== null && value !== "";
    }),
  };
}

module.exports = {
  matchBuyersForProduct,
  recommendProductsForBuyer,
  rankMatches,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
