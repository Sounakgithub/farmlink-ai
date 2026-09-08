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

    if (farmerId && isValidId(farmerId)) filter.farmerId = farmerId;
    if (crop) filter.cropName = new RegExp(`^${crop}$`, "i");
    if (location) filter.location = new RegExp(location, "i");
    if (inStock === "true") filter.quantity = { $gt: 0 };

    if (search) {
      const term = new RegExp(search, "i");
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

    const product = await Product.create({
      farmerId: req.user._id,
      farmerName: req.user.name,
      cropName: String(cropName).trim(),
      quantity: numericQuantity,
      unit: unit || "kg",
      location: String(location).trim(),
      pricePerKg: numericPrice,
      image: image || "",
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
