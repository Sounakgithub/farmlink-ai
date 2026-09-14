const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { protect, requireRole } = require("../middleware/auth");

const router = express.Router();

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// ---------------------------------------------------------------------------
// GET /api/products/mine  -  the logged-in farmer's own crops
// Declared before "/:id" style routes so it is not swallowed by them.
// ---------------------------------------------------------------------------
router.get("/mine", protect, requireRole("farmer"), async (req, res) => {
  try {
    const products = await Product.find({ farmerId: req.user._id }).sort({
      createdAt: -1,
    });

    res.json(products);
  } catch (error) {
    console.error("GET MY PRODUCTS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/products/stats  -  headline numbers for the farmer dashboard
// ---------------------------------------------------------------------------
router.get("/stats", protect, requireRole("farmer"), async (req, res) => {
  try {
    const farmerId = req.user._id;

    const products = await Product.find({ farmerId });

    const orders = await Order.find({ "products.farmerId": farmerId });

    let earnings = 0;
    let activeOrders = 0;
    let pendingDeliveries = 0;

    for (const order of orders) {
      const myLines = order.products.filter(
        (line) => String(line.farmerId) === String(farmerId)
      );
      const lineTotal = myLines.reduce((sum, l) => sum + l.totalPrice, 0);

      if (order.status === "Delivered") earnings += lineTotal;
      if (["Pending", "Accepted", "Confirmed", "In Transit"].includes(order.status)) {
        activeOrders += 1;
      }
      if (["Accepted", "Confirmed", "In Transit"].includes(order.status)) {
        pendingDeliveries += 1;
      }
    }

    res.json({
      totalProducts: products.length,
      totalStockKg: products.reduce((sum, p) => sum + p.quantity, 0),
      activeOrders,
      pendingDeliveries,
      earnings,
    });
  } catch (error) {
    console.error("PRODUCT STATS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/products  -  public marketplace listing
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const { farmerId, crop, location, search, inStock } = req.query;

    const filter = {};
    // Query text is matched literally: an unescaped pattern could throw on
    // "(" or be crafted to make the regex engine backtrack for seconds.
    const literal = (text) => String(text).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    if (farmerId && isValidId(farmerId)) filter.farmerId = farmerId;
    if (crop) filter.cropName = new RegExp(`^${literal(crop)}$`, "i");
    if (location) filter.location = new RegExp(literal(location), "i");
    if (inStock === "true") filter.quantity = { $gt: 0 };

    if (search) {
      const term = new RegExp(literal(search), "i");
      filter.$or = [{ cropName: term }, { farmerName: term }, { location: term }];
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });

    res.json(products);
  } catch (error) {
    console.error("GET PRODUCTS ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/products/:id
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Optional wholesale fields, shared by create and edit.
//
// bulkTiers: [{ minQuantityKg, pricePerKg }] - each must be cheaper than the
// base price and than every smaller tier. coordinates: { lat, lng } or null.
// Returns { values, error }; undefined values mean "not sent, leave as-is".
// ---------------------------------------------------------------------------
function readWholesaleFields(body, basePrice) {
  const values = {};

  if (body.bulkTiers !== undefined) {
    if (body.bulkTiers === null || body.bulkTiers === "") {
      values.bulkTiers = [];
    } else if (!Array.isArray(body.bulkTiers)) {
      return { error: "Bulk tiers must be a list." };
    } else {
      if (body.bulkTiers.length > 5) return { error: "At most 5 bulk tiers." };
      const tiers = [];
      for (const raw of body.bulkTiers) {
        const minQuantityKg = Number(raw && raw.minQuantityKg);
        const pricePerKg = Number(raw && raw.pricePerKg);
        if (!Number.isFinite(minQuantityKg) || minQuantityKg < 2) {
          return { error: "Each bulk tier needs a minimum quantity of at least 2 kg." };
        }
        if (!Number.isFinite(pricePerKg) || pricePerKg < 1) {
          return { error: "Each bulk tier needs a price of at least 1." };
        }
        if (pricePerKg >= basePrice) {
          return { error: `A bulk price (${pricePerKg}) must be below the base price (${basePrice}).` };
        }
        tiers.push({ minQuantityKg, pricePerKg });
      }
      tiers.sort((a, b) => a.minQuantityKg - b.minQuantityKg);
      for (let i = 1; i < tiers.length; i += 1) {
        if (tiers[i].minQuantityKg === tiers[i - 1].minQuantityKg) {
          return { error: "Two bulk tiers cannot start at the same quantity." };
        }
        if (tiers[i].pricePerKg >= tiers[i - 1].pricePerKg) {
          return { error: "Bulk prices must fall as the quantity rises." };
        }
      }
      values.bulkTiers = tiers;
    }
  }

  if (body.coordinates !== undefined) {
    if (body.coordinates === null) {
      values.coordinates = null;
    } else {
      const lat = Number(body.coordinates && body.coordinates.lat);
      const lng = Number(body.coordinates && body.coordinates.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return { error: "Coordinates need a valid lat and lng." };
      }
      values.coordinates = { lat, lng };
    }
  }

  if (body.needsRefrigeration !== undefined) {
    values.needsRefrigeration = body.needsRefrigeration === true || body.needsRefrigeration === "true";
  }

  return { values };
}

// ---------------------------------------------------------------------------
// POST /api/products  -  farmer adds a crop
// farmerId / farmerName come from the token, never from the request body,
// so a listing can never be created without an owner.
// ---------------------------------------------------------------------------
router.post("/", protect, requireRole("farmer"), async (req, res) => {
  try {
    const { cropName, quantity, unit, location, pricePerKg, image } = req.body;

    if (!cropName || !location) {
      return res.status(400).json({
        message: "Crop name and location are required.",
      });
    }

    const numericQuantity = Number(quantity);
    const numericPrice = Number(pricePerKg);

    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      return res.status(400).json({ message: "Quantity must be a positive number." });
    }

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return res.status(400).json({ message: "Price must be a positive number." });
    }

    const wholesale = readWholesaleFields(req.body, numericPrice);
    if (wholesale.error) {
      return res.status(400).json({ message: wholesale.error });
    }

    const product = await Product.create({
      farmerId: req.user._id,
      farmerName: req.user.name,
      cropName: String(cropName).trim(),
      quantity: numericQuantity,
      unit: unit || "kg",
      location: String(location).trim(),
      pricePerKg: numericPrice,
      image: image || "",
      bulkTiers: wholesale.values.bulkTiers || [],
      coordinates: wholesale.values.coordinates || undefined,
      needsRefrigeration: wholesale.values.needsRefrigeration || false,
    });

    res.status(201).json({
      message: "Product listed successfully",
      product,
    });
  } catch (error) {
    console.error("PRODUCT SAVE ERROR:", error);
    res.status(400).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/products/:id  -  farmer edits their own crop
// ---------------------------------------------------------------------------
router.patch("/:id", protect, requireRole("farmer"), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    if (String(product.farmerId) !== String(req.user._id)) {
      return res.status(403).json({
        message: "You can only edit your own listings.",
      });
    }

    const { cropName, quantity, unit, location, pricePerKg, image } = req.body;

    if (cropName !== undefined) product.cropName = String(cropName).trim();
    if (location !== undefined) product.location = String(location).trim();
    if (unit !== undefined) product.unit = unit;
    if (image !== undefined) product.image = image;

    if (quantity !== undefined) {
      const n = Number(quantity);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: "Quantity must be 0 or more." });
      }
      product.quantity = n;
    }

    if (pricePerKg !== undefined) {
      const n = Number(pricePerKg);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: "Price must be a positive number." });
      }
      product.pricePerKg = n;
    }

    // Validate tiers against the price the listing will have after this edit.
    const wholesale = readWholesaleFields(
      {
        ...req.body,
        bulkTiers:
          req.body.bulkTiers !== undefined
            ? req.body.bulkTiers
            : pricePerKg !== undefined && product.bulkTiers.length
              ? product.bulkTiers.map((t) => ({ minQuantityKg: t.minQuantityKg, pricePerKg: t.pricePerKg }))
              : undefined,
      },
      product.pricePerKg
    );
    if (wholesale.error) {
      return res.status(400).json({ message: wholesale.error });
    }
    if (wholesale.values.bulkTiers !== undefined) product.bulkTiers = wholesale.values.bulkTiers;
    if (wholesale.values.coordinates !== undefined) {
      product.coordinates = wholesale.values.coordinates || undefined;
    }
    if (wholesale.values.needsRefrigeration !== undefined) {
      product.needsRefrigeration = wholesale.values.needsRefrigeration;
    }

    const updated = await product.save();

    res.json({ message: "Product updated successfully", product: updated });
  } catch (error) {
    console.error("PRODUCT UPDATE ERROR:", error);
    res.status(400).json({ message: error.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/products/:id  -  farmer removes their own crop
// ---------------------------------------------------------------------------
router.delete("/:id", protect, requireRole("farmer"), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id." });
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found." });
    }

    if (String(product.farmerId) !== String(req.user._id)) {
      return res.status(403).json({
        message: "You can only delete your own listings.",
      });
    }

    // Refuse to delete while the crop is part of a live order.
    const liveOrder = await Order.findOne({
      "products.productId": product._id,
      status: { $in: ["Pending", "Accepted", "Confirmed", "In Transit"] },
    });

    if (liveOrder) {
      return res.status(409).json({
        message:
          "This crop is part of an active order and cannot be deleted yet. " +
          "Set its quantity to 0 to hide it from the marketplace instead.",
      });
    }

    await product.deleteOne();

    res.json({ message: "Product deleted successfully", id: product._id });
  } catch (error) {
    console.error("PRODUCT DELETE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
