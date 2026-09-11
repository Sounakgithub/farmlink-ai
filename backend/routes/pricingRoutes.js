const express = require("express");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { protect } = require("../middleware/auth");
const { computeFairDeal, qualityNote } = require("../utils/fairPrice");
const { geocode } = require("../utils/geocode");
const { haversineKm } = require("../utils/routeOptimizer");

const router = express.Router();

// A reference built from a handful of listings is noise, not a market rate.
const THIN_MARKET = 3;

/**
 * The observed market reference for a crop: the median of what farmers are
 * actually asking for it on FarmLink.
 *
 * Prefers listings in the same city, because a Delhi price is not a Patna
 * price, and widens to the whole platform when the local market is too thin
 * to be meaningful. Falls back to recently traded prices if nothing is listed.
 * Always reports which of those it used and how many rows it saw.
 */
async function marketReference(cropName, location) {
  const crop = String(cropName || "").trim();
  if (!crop) return null;

  const cropFilter = { cropName: new RegExp(`^${crop}$`, "i") };

  const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  // 1. same city
  if (location) {
    const local = await Product.find({
      ...cropFilter,
      location: new RegExp(String(location).trim(), "i"),
    }).select("pricePerKg");

    const prices = local.map((p) => p.pricePerKg).filter((p) => p > 0);
    if (prices.length >= THIN_MARKET) {
      return {
        pricePerKg: median(prices),
        sampleSize: prices.length,
        basis: "listings-in-this-city",
        thin: false,
      };
    }
  }

  // 2. the whole platform
  const all = await Product.find(cropFilter).select("pricePerKg");
  const allPrices = all.map((p) => p.pricePerKg).filter((p) => p > 0);
  if (allPrices.length > 0) {
    return {
      pricePerKg: median(allPrices),
      sampleSize: allPrices.length,
      basis: "listings-across-farmlink",
      thin: allPrices.length < THIN_MARKET,
    };
  }

  // 3. nothing listed - fall back to what this crop has actually sold for
  const orders = await Order.find({ "products.cropName": new RegExp(`^${crop}$`, "i") })
    .select("products.cropName products.pricePerKg")
    .limit(200);

  const traded = [];
  for (const order of orders) {
    for (const line of order.products) {
      if (new RegExp(`^${crop}$`, "i").test(line.cropName) && line.pricePerKg > 0) {
        traded.push(line.pricePerKg);
      }
    }
  }

  if (traded.length > 0) {
    return {
      pricePerKg: median(traded),
      sampleSize: traded.length,
      basis: "past-orders",
      thin: traded.length < THIN_MARKET,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// GET /api/pricing/reference?crop=Tomato&location=Delhi
// ---------------------------------------------------------------------------
router.get("/reference", protect, async (req, res) => {
  try {
    const { crop, location } = req.query;

    if (!crop) {
      return res.status(400).json({ message: "A crop is required." });
    }

    const reference = await marketReference(crop, location);

    if (!reference) {
      return res.status(404).json({
        message: `No FarmLink price history for ${crop} yet.`,
        crop,
      });
    }

    res.json({ crop, location: location || null, reference });
  } catch (error) {
    console.error("PRICE REFERENCE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pricing/fair-deal
// body: { cropName, pricePerKg?, quantityKg?, location?, buyerLocation?, split? }
//
// What a price means for both sides: what the farmer earns over a farm-gate
// sale, and what the buyer saves against a typical shop price.
// ---------------------------------------------------------------------------
router.post("/fair-deal", protect, async (req, res) => {
  try {
    const {
      cropName,
      pricePerKg,
      quantityKg,
      location,
      buyerLocation,
      split,
    } = req.body || {};

    if (!cropName) {
      return res.status(400).json({ message: "A crop name is required." });
    }

    if (pricePerKg !== undefined && pricePerKg !== null) {
      const price = Number(pricePerKg);
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({ message: "Price must be a positive number." });
      }
    }

    const reference = await marketReference(cropName, location);

    if (!reference) {
      // No reference means no honest comparison. Say so rather than inventing
      // a baseline to compare against.
      return res.status(404).json({
        message:
          `There are not enough ${cropName} prices on FarmLink yet to work out ` +
          "a fair-deal comparison.",
        crop: cropName,
        deal: null,
      });
    }

    const deal = computeFairDeal({
      referencePricePerKg: reference.pricePerKg,
      pricePerKg,
      quantityKg,
      split,
    });

    // Distance farm -> buyer, when both ends are placeable, for the freshness
    // line. Never invents coordinates.
    let transitKm = null;
    const from = geocode(location);
    const to = geocode(buyerLocation);
    if (from && to) transitKm = Number(haversineKm(from, to).toFixed(1));

    res.json({
      crop: cropName,
      location: location || null,
      reference,
      deal,
      quality: qualityNote(transitKm),
      transitKm,
      // A thin sample is still worth showing, but the UI must be able to
      // caveat it rather than presenting two listings as "the market".
      confidence: reference.thin ? "low" : "normal",
    });
  } catch (error) {
    console.error("FAIR DEAL ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
