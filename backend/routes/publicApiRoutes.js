const express = require("express");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { requireApiKey } = require("../middleware/apiKey");
const { priceCart } = require("../utils/orderPricing");
const { getSettings } = require("../utils/settings");
const b2b = require("./b2bRoutes");
const orderRoutes = require("./orderRoutes");

/**
 * The partner API: /api/v1
 *
 * For wholesale buyers integrating their own purchasing systems. Authenticated
 * with an X-API-Key minted from a verified business account; every call acts
 * as that account, with the same prices, fees, credit limit and stock rules as
 * the website. Responses are stable, versioned JSON; errors carry a machine
 * readable `error` code alongside a human `message`.
 */

const router = express.Router();

function fail(res, error, fallback = "server_error") {
  if (!error.status) console.error("PUBLIC API ERROR:", error);
  const status = error.status || 500;
  const code =
    status === 400 ? "invalid_request"
      : status === 402 ? "credit_limit_exceeded"
        : status === 403 ? "forbidden"
          : status === 404 ? "not_found"
            : status === 409 ? "conflict"
              : fallback;
  res.status(status).json({ error: code, message: error.message });
}

const publicOrder = (order) => ({
  id: order._id,
  status: order.status,
  channel: order.channel,
  createdAt: order.createdAt,
  lines: order.products.map((l) => ({
    productId: l.productId,
    crop: l.cropName,
    farmer: l.farmerName,
    quantityKg: l.quantity,
    pricePerKg: l.pricePerKg,
    total: l.totalPrice,
  })),
  charges: {
    goods: order.charges?.goods ?? order.totalAmount,
    deliveryFee: order.charges?.deliveryFee ?? 0,
    grandTotal: order.charges?.grandTotal ?? order.totalAmount,
    currency: "INR",
  },
  payment: {
    method: order.paymentMethod,
    status: order.paymentStatus,
    invoice: order.invoice
      ? {
          number: order.invoice.number,
          terms: order.invoice.terms,
          dueAt: order.invoice.dueAt,
          paidAt: order.invoice.paidAt || null,
        }
      : null,
  },
  settlement: order.settlement?.status,
  delivery: {
    address: order.deliveryAddress,
    carrier: order.logistics?.providerName || (order.logistics?.mode === "independent" ? "FarmLink delivery partner" : null),
    distanceKm: order.charges?.quote?.distanceKm ?? null,
    etaMinutes: order.charges?.quote?.durationMin ?? null,
  },
  quality: {
    pickup: order.inspection?.pickup?.result
      ? { result: order.inspection.pickup.result, grade: order.inspection.pickup.grade }
      : null,
    delivery: order.inspection?.delivery?.result
      ? { result: order.inspection.delivery.result, condition: order.inspection.delivery.condition }
      : null,
  },
});

// GET /api/v1  -  what this key can do
router.get("/", requireApiKey(), (req, res) => {
  res.json({
    version: "v1",
    account: {
      company: req.user.business?.companyName,
      gstin: req.user.business?.gstin,
    },
    scopes: req.apiKey.scopes,
    rateLimitPerMinute: req.apiKey.rateLimitPerMinute,
    endpoints: [
      "GET  /api/v1/products",
      "POST /api/v1/quotes",
      "POST /api/v1/orders",
      "GET  /api/v1/orders",
      "GET  /api/v1/orders/:id",
    ],
  });
});

// GET /api/v1/products?crop=&location=&minQuantityKg=&page=&limit=
router.get("/products", requireApiKey("products:read"), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const filter = { quantity: { $gt: 0 } };
    const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (req.query.crop) filter.cropName = new RegExp(`^${escape(req.query.crop)}$`, "i");
    if (req.query.location) filter.location = new RegExp(escape(req.query.location), "i");
    if (req.query.minQuantityKg) {
      const min = Number(req.query.minQuantityKg);
      if (Number.isFinite(min) && min > 0) filter.quantity = { $gte: min };
    }

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    ]);

    res.json({
      page,
      limit,
      total,
      data: products.map((p) => ({
        id: p._id,
        crop: p.cropName,
        farmer: p.farmerName,
        location: p.location,
        availableKg: p.quantity,
        pricePerKg: p.pricePerKg,
        bulkTiers: (p.bulkTiers || []).map((t) => ({
          minQuantityKg: t.minQuantityKg,
          pricePerKg: t.pricePerKg,
        })),
        needsRefrigeration: !!p.needsRefrigeration,
        listedAt: p.createdAt,
      })),
    });
  } catch (error) {
    fail(res, error);
  }
});

// POST /api/v1/quotes  -  { items: [{ productId, quantity }], deliveryAddress }
router.post("/quotes", requireApiKey("quotes:write"), async (req, res) => {
  try {
    const settings = await getSettings();
    const priced = await priceCart({
      items: req.body?.items,
      buyer: req.user,
      deliveryAddress: req.body?.deliveryAddress || req.user.location,
      minLineKg: settings.b2b.minLineQuantityKg,
    });
    const credit = await b2b.creditPosition(req.user);

    res.json({
      currency: "INR",
      lines: priced.lines.map((l) => ({
        productId: l.productId,
        crop: l.cropName,
        quantityKg: l.quantity,
        listPricePerKg: l.listPricePerKg,
        pricePerKg: l.pricePerKg,
        bulkTierApplied: l.bulkTierApplied,
        total: l.totalPrice,
      })),
      goods: priced.charges.goods,
      deliveryFee: priced.charges.deliveryFee,
      grandTotal: priced.charges.grandTotal,
      delivery: priced.charges.quote,
      credit: {
        terms: credit.terms,
        available: credit.available,
        invoiceAllowed: credit.approved && priced.charges.grandTotal <= credit.available,
      },
      validForMinutes: 15,
    });
  } catch (error) {
    fail(res, error);
  }
});

// POST /api/v1/orders
router.post("/orders", requireApiKey("orders:write"), async (req, res) => {
  try {
    const order = await b2b.placeWholesaleOrder(req, "api");
    res.status(201).json(publicOrder(order));
  } catch (error) {
    fail(res, error);
  }
});

// GET /api/v1/orders?status=&page=&limit=
router.get("/orders", requireApiKey("orders:read"), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const filter = { buyerId: req.user._id };
    if (req.query.status) filter.status = String(req.query.status);

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    ]);

    res.json({ page, limit, total, data: orders.map(publicOrder) });
  } catch (error) {
    fail(res, error);
  }
});

// GET /api/v1/orders/:id
router.get("/orders/:id", requireApiKey("orders:read"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "invalid_request", message: "Invalid order id." });
    }
    const order = await Order.findOne({ _id: req.params.id, buyerId: req.user._id });
    if (!order) return res.status(404).json({ error: "not_found", message: "Order not found." });
    res.json(publicOrder(order));
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
