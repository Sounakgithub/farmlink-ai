const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const { protect, requireRole } = require("../middleware/auth");
const {
  matchBuyersForProduct,
  recommendProductsForBuyer,
  DEFAULT_LIMIT,
} = require("../utils/matching");

const router = express.Router();

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ---------------------------------------------------------------------------
// GET /api/matching/product/:productId/buyers
//
// Farmer asks: who should I sell this crop to?
// Ownership is enforced - a farmer can only run this against their OWN
// listing, so it cannot be used to enumerate the buyer base from someone
// else's product.
// ---------------------------------------------------------------------------
router.get(
  "/product/:productId/buyers",
  protect,
  requireRole("farmer"),
  async (req, res) => {
    try {
      const { productId } = req.params;

      if (!isValidId(productId)) {
        return res.status(400).json({ message: "Invalid product id." });
      }

      const product = await Product.findById(productId);

      if (!product) {
        return res.status(404).json({ message: "Product not found." });
      }

      if (String(product.farmerId) !== String(req.user._id)) {
        return res.status(403).json({
          message: "You can only find buyers for your own listings.",
        });
      }

      const { matches, candidatesConsidered, mlAvailable } =
        await matchBuyersForProduct(product, { limit: req.query.limit });

      res.json({
        product: {
          _id: product._id,
          cropName: product.cropName,
          quantity: product.quantity,
          unit: product.unit,
          location: product.location,
          pricePerKg: product.pricePerKg,
          inStock: product.quantity > 0,
        },
        matches,
        count: matches.length,
        candidatesConsidered,
        limit: Number(req.query.limit) || DEFAULT_LIMIT,
        // Surfaced so the UI can tell the farmer the demand pillar was a
        // neutral stand-in rather than a real forecast.
        demandForecastAvailable: mlAvailable,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("BUYER MATCHING ERROR:", error);
      res.status(500).json({ message: "Could not work out buyer matches right now." });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/matching/buyer/recommendations
//
// Buyer asks: what should I buy, and from whom?
// ---------------------------------------------------------------------------
router.get(
  "/buyer/recommendations",
  protect,
  requireRole("buyer"),
  async (req, res) => {
    try {
      const result = await recommendProductsForBuyer(req.user, {
        limit: req.query.limit,
        includeOutOfStock: req.query.includeOutOfStock === "true",
      });

      res.json({
        matches: result.matches,
        count: result.matches.length,
        candidatesConsidered: result.candidatesConsidered,
        limit: Number(req.query.limit) || DEFAULT_LIMIT,
        demandForecastAvailable: result.mlAvailable,
        // Lets the UI nudge a new buyer towards filling in preferences
        // instead of silently handing them generic neutral scores.
        personalisation: {
          hasHistory: result.buyerHasHistory,
          hasPreferences: result.buyerHasPreferences,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("BUYER RECOMMENDATION ERROR:", error);
      res.status(500).json({ message: "Could not work out recommendations right now." });
    }
  }
);

module.exports = router;
