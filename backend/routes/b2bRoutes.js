const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const ApiKey = require("../models/ApiKey");
const { SCOPES } = require("../models/ApiKey");
const { protect, requireRole } = require("../middleware/auth");
const { priceCart } = require("../utils/orderPricing");
const settlement = require("../utils/settlement");
const { getSettings } = require("../utils/settings");
const { audit } = require("../utils/audit");
const orderRoutes = require("./orderRoutes");

/**
 * Wholesale trading.
 *
 * A buyer asks to become a business account (company name + GSTIN). Until an
 * admin verifies it they stay a consumer - otherwise anyone could claim the
 * lower business fee tier or grant themselves credit. Once approved they get:
 *
 *   - the business fee tier
 *   - bulk quotes across many lines, with farmers' volume tiers applied
 *   - optionally, credit terms (net-15 / net-30) up to a limit an admin sets
 *   - partner API keys for /api/v1
 */

const router = express.Router();

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const TERM_DAYS = { net15: 15, net30: 30 };
const OPEN_INVOICE = { paymentStatus: "Invoiced", status: { $nin: ["Cancelled", "Rejected"] } };

const send = (res, error, label) => {
  if (!error.status) console.error(`${label}:`, error);
  res.status(error.status || 500).json({ message: error.message });
};

function requireBusiness(req, res, next) {
  if (req.user.accountType !== "business" || req.user.business?.status !== "approved") {
    return res.status(403).json({
      message: "Wholesale trading needs a verified business account.",
      code: "BUSINESS_ACCOUNT_REQUIRED",
    });
  }
  next();
}

/** Money owed on unpaid invoices. */
async function creditExposure(buyerId) {
  const open = await Order.find({ buyerId, ...OPEN_INVOICE }).select("charges.grandTotal totalAmount");
  return (
    Math.round(
      open.reduce((sum, o) => sum + (o.charges?.grandTotal ?? o.totalAmount), 0) * 100
    ) / 100
  );
}

async function creditPosition(user) {
  const exposure = await creditExposure(user._id);
  const limit = user.business?.creditLimit || 0;
  return {
    approved: user.hasApprovedCredit(),
    terms: user.business?.paymentTerms || "prepaid",
    limit,
    exposure,
    available: Math.max(0, Math.round((limit - exposure) * 100) / 100),
  };
}

// ---------------------------------------------------------------------------
// GET /api/b2b/account
// ---------------------------------------------------------------------------
router.get("/account", protect, requireRole("buyer"), async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      accountType: req.user.accountType,
      business: req.user.business || { status: "none" },
      credit: await creditPosition(req.user),
      minLineQuantityKg: settings.b2b.minLineQuantityKg,
      fees: settings.fees[req.user.accountType === "business" ? "business" : "consumer"],
    });
  } catch (error) {
    send(res, error, "B2B ACCOUNT ERROR");
  }
});

// ---------------------------------------------------------------------------
// POST /api/b2b/account  -  { companyName, gstin }  request a business account
// ---------------------------------------------------------------------------
router.post("/account", protect, requireRole("buyer"), async (req, res) => {
  try {
    const companyName = String(req.body?.companyName || "").trim();
    const gstin = String(req.body?.gstin || "").trim().toUpperCase();

    if (companyName.length < 2) {
      return res.status(400).json({ message: "Enter your registered company name." });
    }
    if (!GSTIN.test(gstin)) {
      return res.status(400).json({ message: "Enter a valid 15-character GSTIN." });
    }
    if (req.user.business?.status === "approved") {
      return res.status(409).json({ message: "Your business account is already verified." });
    }

    req.user.business = {
      ...(req.user.business?.toObject ? req.user.business.toObject() : req.user.business || {}),
      companyName,
      gstin,
      status: "requested",
    };
    await req.user.save();

    await audit(req, "b2b.account_requested", "User", req.user._id, { companyName, gstin });

    res.status(201).json({
      message: "Request received. An admin will verify your GSTIN and set up your account.",
      business: req.user.business,
    });
  } catch (error) {
    send(res, error, "B2B REQUEST ERROR");
  }
});

// ---------------------------------------------------------------------------
// POST /api/b2b/quote  -  { items, deliveryAddress }
// ---------------------------------------------------------------------------
router.post("/quote", protect, requireRole("buyer"), requireBusiness, async (req, res) => {
  try {
    const settings = await getSettings();
    const { items, deliveryAddress } = req.body || {};

    const priced = await priceCart({
      items,
      buyer: req.user,
      deliveryAddress: deliveryAddress || req.user.location,
      minLineKg: settings.b2b.minLineQuantityKg,
    });

    const credit = await creditPosition(req.user);
    const grandTotal = priced.charges.grandTotal;

    const bulkSavings =
      Math.round(
        priced.lines.reduce(
          (sum, l) => sum + (l.listPricePerKg - l.pricePerKg) * l.quantity,
          0
        ) * 100
      ) / 100;

    res.json({
      ...orderRoutes.quoteResponse(priced, req.user),
      bulkSavings,
      credit: {
        ...credit,
        canUseInvoice: credit.approved && grandTotal <= credit.available,
        reason: !credit.approved
          ? "No credit terms on this account - pay upfront."
          : grandTotal > credit.available
            ? `This order (₹${grandTotal}) exceeds your available credit (₹${credit.available}).`
            : null,
      },
      validForMinutes: 15,
    });
  } catch (error) {
    send(res, error, "B2B QUOTE ERROR");
  }
});

// ---------------------------------------------------------------------------
// POST /api/b2b/orders
// { items, deliveryAddress, deliveryInstructions, paymentMethod }
// paymentMethod: "Invoice" (credit terms) or an upfront method.
// ---------------------------------------------------------------------------
router.post("/orders", protect, requireRole("buyer"), requireBusiness, async (req, res) => {
  try {
    const order = await placeWholesaleOrder(req, "b2b");
    res.status(201).json({
      message:
        order.paymentMethod === "Invoice"
          ? `Order placed on ${order.invoice.terms} terms. Invoice ${order.invoice.number} is due ${order.invoice.dueAt.toDateString()}.`
          : "Wholesale order placed.",
      order: orderRoutes.projectForUser(order, req.user),
    });
  } catch (error) {
    send(res, error, "B2B ORDER ERROR");
  }
});

/** Shared with the partner API. */
async function placeWholesaleOrder(req, channel) {
  const settings = await getSettings();
  const { items, deliveryAddress, deliveryInstructions } = req.body || {};
  const method = req.body?.paymentMethod || "Invoice";

  const allowed = ["Invoice", "UPI", "Card", "Net Banking"];
  if (!allowed.includes(method)) {
    throw Object.assign(new Error(`Payment method must be one of ${allowed.join(", ")}.`), { status: 400 });
  }

  let invoice;
  if (method === "Invoice") {
    const credit = await creditPosition(req.user);
    if (!credit.approved) {
      throw Object.assign(new Error("This account has no credit terms. Choose an upfront payment method."), {
        status: 403,
      });
    }

    // Price first so the credit check uses the real total.
    const preview = await priceCart({
      items,
      buyer: req.user,
      deliveryAddress: deliveryAddress || req.user.location,
      minLineKg: settings.b2b.minLineQuantityKg,
    });
    if (preview.charges.grandTotal > credit.available) {
      throw Object.assign(
        new Error(
          `This order (₹${preview.charges.grandTotal}) exceeds your available credit (₹${credit.available}).`
        ),
        { status: 402 }
      );
    }

    const issuedAt = new Date();
    const stamp = issuedAt.toISOString().slice(0, 10).replace(/-/g, "");
    invoice = {
      number: `FL-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      terms: credit.terms,
      issuedAt,
      dueAt: new Date(issuedAt.getTime() + TERM_DAYS[credit.terms] * 86400e3),
    };
  }

  return orderRoutes.placeOrder({
    req,
    items,
    address: deliveryAddress || req.user.location || "",
    deliveryInstructions,
    method,
    channel,
    minLineKg: settings.b2b.minLineQuantityKg,
    invoice,
  });
}

// ---------------------------------------------------------------------------
// GET /api/b2b/invoices
// ---------------------------------------------------------------------------
router.get("/invoices", protect, requireRole("buyer"), async (req, res) => {
  try {
    const orders = await Order.find({ buyerId: req.user._id, paymentMethod: "Invoice" }).sort({
      createdAt: -1,
    });
    const now = Date.now();

    res.json({
      credit: await creditPosition(req.user),
      invoices: orders.map((o) => ({
        orderId: o._id,
        number: o.invoice?.number,
        terms: o.invoice?.terms,
        issuedAt: o.invoice?.issuedAt,
        dueAt: o.invoice?.dueAt,
        paidAt: o.invoice?.paidAt,
        amount: o.charges?.grandTotal ?? o.totalAmount,
        orderStatus: o.status,
        state: o.invoice?.paidAt
          ? "paid"
          : ["Cancelled", "Rejected"].includes(o.status)
            ? "void"
            : o.invoice?.dueAt && o.invoice.dueAt.getTime() < now
              ? "overdue"
              : "open",
      })),
    });
  } catch (error) {
    send(res, error, "B2B INVOICES ERROR");
  }
});

// ---------------------------------------------------------------------------
// POST /api/b2b/invoices/:orderId/pay
// Settles an invoice through the mock payment rail.
// ---------------------------------------------------------------------------
router.post("/invoices/:orderId/pay", protect, requireRole("buyer"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
      return res.status(400).json({ message: "Invalid order id." });
    }
    const order = await Order.findOne({
      _id: req.params.orderId,
      buyerId: req.user._id,
      paymentMethod: "Invoice",
    });
    if (!order) return res.status(404).json({ message: "Invoice not found." });

    await settlement.onInvoicePaid(order, req, `mock-${crypto.randomBytes(6).toString("hex")}`);

    // Already delivered and confirmed? Then it can be paid straight out.
    if (order.status === "Delivered" && order.inspection?.delivery?.result === "passed") {
      await settlement.release(order, req, "invoice paid after confirmed delivery");
    }
    await order.save();

    res.json({
      message: `Invoice ${order.invoice?.number} paid.`,
      settlementStatus: order.settlement.status,
    });
  } catch (error) {
    send(res, error, "B2B PAY ERROR");
  }
});

// ---------------------------------------------------------------------------
// Partner API keys
// ---------------------------------------------------------------------------

// GET /api/b2b/api-keys
router.get("/api-keys", protect, requireRole("buyer"), requireBusiness, async (req, res) => {
  try {
    const keys = await ApiKey.find({ ownerId: req.user._id }).sort({ createdAt: -1 });
    res.json({ scopes: SCOPES, keys: keys.map((k) => k.toSafeJSON()) });
  } catch (error) {
    send(res, error, "LIST API KEYS ERROR");
  }
});

// POST /api/b2b/api-keys  -  { name, scopes?, rateLimitPerMinute? }
router.post("/api-keys", protect, requireRole("buyer"), requireBusiness, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (name.length < 2) return res.status(400).json({ message: "Give the key a name." });

    const active = await ApiKey.countDocuments({ ownerId: req.user._id, revokedAt: null });
    if (active >= 10) {
      return res.status(409).json({ message: "Revoke an existing key before creating another (limit 10)." });
    }

    const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes : undefined;
    if (scopes && scopes.some((s) => !SCOPES.includes(s))) {
      return res.status(400).json({ message: `Scopes must be drawn from: ${SCOPES.join(", ")}.` });
    }

    const rate = req.body?.rateLimitPerMinute;
    if (rate !== undefined && (!Number.isInteger(Number(rate)) || Number(rate) < 1 || Number(rate) > 600)) {
      return res.status(400).json({ message: "Rate limit must be a whole number between 1 and 600 per minute." });
    }

    const { plaintext, doc } = await ApiKey.mint({
      ownerId: req.user._id,
      name,
      scopes,
      rateLimitPerMinute: rate ? Number(rate) : undefined,
    });

    await audit(req, "apikey.created", "ApiKey", doc._id, { name, scopes: doc.scopes, prefix: doc.prefix });

    res.status(201).json({
      message: "Copy this key now - it will not be shown again.",
      key: plaintext,
      apiKey: doc.toSafeJSON(),
    });
  } catch (error) {
    send(res, error, "CREATE API KEY ERROR");
  }
});

// DELETE /api/b2b/api-keys/:id  -  revoke
router.delete("/api-keys/:id", protect, requireRole("buyer"), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid key id." });
    }
    const key = await ApiKey.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!key) return res.status(404).json({ message: "API key not found." });
    if (key.revokedAt) return res.status(409).json({ message: "That key is already revoked." });

    key.revokedAt = new Date();
    await key.save();
    await audit(req, "apikey.revoked", "ApiKey", key._id, { prefix: key.prefix });

    res.json({ message: "API key revoked.", apiKey: key.toSafeJSON() });
  } catch (error) {
    send(res, error, "REVOKE API KEY ERROR");
  }
});

module.exports = router;
module.exports.placeWholesaleOrder = placeWholesaleOrder;
module.exports.creditPosition = creditPosition;
