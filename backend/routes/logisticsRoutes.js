const express = require("express");
const mongoose = require("mongoose");
const LogisticsProvider = require("../models/LogisticsProvider");
const LogisticsAssignment = require("../models/LogisticsAssignment");
const Order = require("../models/Order");
const User = require("../models/User");
const { protect, requireRole } = require("../middleware/auth");
const { acceptOffer, rejectOffer, quoteDelivery } = require("../utils/logistics");
const { getSettings } = require("../utils/settings");
const { audit } = require("../utils/audit");

const router = express.Router();

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

function send(res, error, label) {
  if (!error.status) console.error(`${label}:`, error);
  res.status(error.status || 500).json({ message: error.message });
}

// "Flat 3, Palm Grove, Gurgaon" -> "Gurgaon": enough to price a job, not
// enough to find someone's door before the job is accepted.
function region(address) {
  const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

async function myProvider(req, res) {
  const provider = await LogisticsProvider.findOne({ ownerId: req.user._id });
  if (!provider) {
    res.status(404).json({
      message: "Set up your company profile first.",
      code: "PROVIDER_PROFILE_MISSING",
    });
    return null;
  }
  return provider;
}

// ---------------------------------------------------------------------------
// Public: carriers and quotes
// ---------------------------------------------------------------------------

// GET /api/logistics/providers  -  verified carriers, their rates and cover
router.get("/providers", protect, async (req, res) => {
  try {
    const providers = await LogisticsProvider.find({ active: true, verified: true }).sort({
      name: 1,
    });
    res.json({ providers: providers.map((p) => p.toPublic()) });
  } catch (error) {
    send(res, error, "LIST PROVIDERS ERROR");
  }
});

// POST /api/logistics/quote  -  { pickup, drop, weightKg, needsRefrigeration }
router.post("/quote", protect, async (req, res) => {
  try {
    const { pickup, drop, weightKg, needsRefrigeration } = req.body || {};
    const weight = Number(weightKg);

    if (!pickup || !drop) {
      return res.status(400).json({ message: "Both a pickup and a drop location are required." });
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100000) {
      return res.status(400).json({ message: "Weight must be a positive number of kg." });
    }

    const quote = await quoteDelivery({
      lines: [{ location: String(pickup), quantity: weight }],
      dropPlace: String(drop),
      needsRefrigeration: !!needsRefrigeration,
    });

    if (!quote) {
      return res.status(422).json({ message: "One of those places could not be located." });
    }

    const settings = await getSettings();
    const tier = req.user.accountType === "business" ? "business" : "consumer";
    const markup = settings.fees[tier].logisticsMarkupPct / 100;

    res.json({
      distanceKm: quote.route.distanceKm,
      durationMin: quote.route.durationMin,
      routeSource: quote.route.source,
      approximate: quote.route.approximate,
      geometry: quote.route.geometry,
      weightKg: quote.weightKg,
      options: quote.options.map((o) => ({
        carrier: o.carrier,
        providerName: o.providerName,
        carrierRate: o.providerFee,
        deliveryFee: Math.round(o.providerFee * (1 + markup) * 100) / 100,
        liability: o.liability,
        refrigerated: o.refrigerated,
      })),
      recommended: quote.best
        ? { carrier: quote.best.carrier, providerName: quote.best.providerName }
        : null,
    });
  } catch (error) {
    send(res, error, "LOGISTICS QUOTE ERROR");
  }
});

// ---------------------------------------------------------------------------
// Carrier company (role: logistics)
// ---------------------------------------------------------------------------

// GET /api/logistics/provider/me
router.get("/provider/me", protect, requireRole("logistics"), async (req, res) => {
  try {
    const provider = await LogisticsProvider.findOne({ ownerId: req.user._id });
    res.json({
      provider: provider
        ? { ...provider.toPublic(), joinCode: provider.joinCode, active: provider.active, stats: provider.stats, contactEmail: provider.contactEmail, contactPhone: provider.contactPhone, createdAt: provider.createdAt }
        : null,
    });
  } catch (error) {
    send(res, error, "GET PROVIDER ERROR");
  }
});

// PUT /api/logistics/provider/me  -  create or update the company profile
router.put("/provider/me", protect, requireRole("logistics"), async (req, res) => {
  try {
    const body = req.body || {};
    let provider = await LogisticsProvider.findOne({ ownerId: req.user._id });
    const creating = !provider;

    if (creating) {
      if (!body.name || !String(body.name).trim()) {
        return res.status(400).json({ message: "Your company needs a name." });
      }
      provider = new LogisticsProvider({ ownerId: req.user._id, name: String(body.name).trim() });
    }

    const num = (value, min, max) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
    };

    if (body.name !== undefined) provider.name = String(body.name).trim().slice(0, 120);
    if (body.contactEmail !== undefined) provider.contactEmail = String(body.contactEmail).trim();
    if (body.contactPhone !== undefined) provider.contactPhone = String(body.contactPhone).trim();
    if (Array.isArray(body.coverageCities)) provider.coverageCities = body.coverageCities;
    if (Array.isArray(body.vehicleTypes)) {
      provider.vehicleTypes = body.vehicleTypes.map((v) => String(v).trim()).filter(Boolean).slice(0, 10);
    }
    if (body.refrigerated !== undefined) provider.refrigerated = !!body.refrigerated;
    if (body.active !== undefined) provider.active = !!body.active;

    const maxLoad = num(body.maxLoadKg, 1, 100000);
    if (body.maxLoadKg !== undefined && maxLoad === undefined) {
      return res.status(400).json({ message: "Maximum load must be between 1 and 100,000 kg." });
    }
    if (maxLoad !== undefined) provider.maxLoadKg = maxLoad;

    if (body.rateCard) {
      for (const [key, [min, max]] of Object.entries({
        baseFee: [0, 10000],
        perKm: [0, 1000],
        perKg: [0, 100],
        minFee: [0, 10000],
      })) {
        if (body.rateCard[key] === undefined) continue;
        const value = num(body.rateCard[key], min, max);
        if (value === undefined) {
          return res.status(400).json({ message: `Rate card ${key} must be between ${min} and ${max}.` });
        }
        provider.rateCard[key] = value;
      }
    }

    if (body.liability) {
      const coverage = num(body.liability.coveragePct, 0, 100);
      const cap = num(body.liability.maxPerOrder, 0, 10000000);
      if (body.liability.coveragePct !== undefined && coverage === undefined) {
        return res.status(400).json({ message: "Liability coverage must be 0-100%." });
      }
      if (body.liability.maxPerOrder !== undefined && cap === undefined) {
        return res.status(400).json({ message: "Liability cap must be a positive amount." });
      }
      if (coverage !== undefined) provider.liability.coveragePct = coverage;
      if (cap !== undefined) provider.liability.maxPerOrder = cap;
    }

    // Changing where you operate or what you charge sends the company back
    // for verification only when it is first created; later edits stand, and
    // are audited.
    await provider.save();

    await audit(req, creating ? "provider.created" : "provider.updated", "LogisticsProvider", provider._id, {
      coverageCities: provider.coverageCities,
      rateCard: provider.rateCard,
      liability: provider.liability,
    });

    res.status(creating ? 201 : 200).json({
      message: creating
        ? "Company created. An admin will verify it before you are offered deliveries."
        : "Company profile saved.",
      provider: { ...provider.toPublic(), joinCode: provider.joinCode, active: provider.active, stats: provider.stats },
    });
  } catch (error) {
    send(res, error, "SAVE PROVIDER ERROR");
  }
});

// GET /api/logistics/assignments?status=offered
router.get("/assignments", protect, requireRole("logistics"), async (req, res) => {
  try {
    const provider = await myProvider(req, res);
    if (!provider) return;

    const filter = { providerId: provider._id };
    if (req.query.status) filter.status = String(req.query.status);

    const assignments = await LogisticsAssignment.find(filter).sort({ createdAt: -1 }).limit(100);
    const orders = await Order.find({ _id: { $in: assignments.map((a) => a.orderId) } });
    const byId = new Map(orders.map((o) => [String(o._id), o]));

    res.json({
      assignments: assignments.map((a) => {
        const order = byId.get(String(a.orderId));
        const accepted = a.status === "accepted";
        return {
          id: a._id,
          status: a.status,
          rank: a.rank,
          quote: a.quote,
          liability: a.liability,
          expiresAt: a.expiresAt,
          respondedAt: a.respondedAt,
          reason: a.reason,
          driverId: a.driverId,
          order: order
            ? {
                id: order._id,
                status: order.status,
                crops: order.products.map((l) => `${l.quantity}kg ${l.cropName}`),
                pickup: [...new Set(order.products.map((l) => l.location))],
                // Full address only once the job is theirs.
                drop: accepted ? order.deliveryAddress : region(order.deliveryAddress),
                buyerName: accepted ? order.buyerName : undefined,
                pickupInspection: order.inspection?.pickup?.result || null,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    send(res, error, "LIST ASSIGNMENTS ERROR");
  }
});

// POST /api/logistics/assignments/:id/accept  -  { driverId }
router.post("/assignments/:id/accept", protect, requireRole("logistics"), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid offer id." });
    const provider = await myProvider(req, res);
    if (!provider) return;

    const assignment = await LogisticsAssignment.findOne({
      _id: req.params.id,
      providerId: provider._id,
    });
    if (!assignment) return res.status(404).json({ message: "Offer not found." });

    const driverId = req.body?.driverId;
    if (!driverId || !isValidId(driverId)) {
      return res.status(400).json({ message: "Choose the driver who will run this delivery." });
    }

    const { order, driver } = await acceptOffer(assignment, provider, driverId, req);
    res.json({
      message: `Delivery accepted - ${driver.name} will collect it.`,
      orderId: order._id,
      deliveryAddress: order.deliveryAddress,
    });
  } catch (error) {
    send(res, error, "ACCEPT OFFER ERROR");
  }
});

// POST /api/logistics/assignments/:id/reject  -  { reason }
router.post("/assignments/:id/reject", protect, requireRole("logistics"), async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid offer id." });
    const provider = await myProvider(req, res);
    if (!provider) return;

    const assignment = await LogisticsAssignment.findOne({
      _id: req.params.id,
      providerId: provider._id,
    });
    if (!assignment) return res.status(404).json({ message: "Offer not found." });

    const { next } = await rejectOffer(assignment, provider, req.body?.reason, req);
    res.json({
      message: "Offer declined.",
      passedTo: next ? (next.mode === "offered" ? next.provider.name : "independent delivery partners") : null,
    });
  } catch (error) {
    send(res, error, "REJECT OFFER ERROR");
  }
});

// GET /api/logistics/drivers  -  drivers in my company
router.get("/drivers", protect, requireRole("logistics"), async (req, res) => {
  try {
    const provider = await myProvider(req, res);
    if (!provider) return;
    const drivers = await User.find({ role: "driver", providerId: provider._id }).select("name phone location createdAt");
    res.json({
      joinCode: provider.joinCode,
      drivers: drivers.map((d) => ({ id: d._id, name: d.name, phone: d.phone, location: d.location })),
    });
  } catch (error) {
    send(res, error, "LIST DRIVERS ERROR");
  }
});

// DELETE /api/logistics/drivers/:driverId  -  remove a driver from my company
router.delete("/drivers/:driverId", protect, requireRole("logistics"), async (req, res) => {
  try {
    if (!isValidId(req.params.driverId)) return res.status(400).json({ message: "Invalid driver id." });
    const provider = await myProvider(req, res);
    if (!provider) return;

    const result = await User.updateOne(
      { _id: req.params.driverId, role: "driver", providerId: provider._id },
      { $set: { providerId: null } }
    );
    if (!result.modifiedCount) return res.status(404).json({ message: "That driver is not in your company." });

    await audit(req, "provider.driver_removed", "LogisticsProvider", provider._id, {
      driverId: req.params.driverId,
    });
    res.json({ message: "Driver removed from your company." });
  } catch (error) {
    send(res, error, "REMOVE DRIVER ERROR");
  }
});

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

// POST /api/logistics/join  -  { code }
router.post("/join", protect, requireRole("driver"), async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ message: "Enter your company's join code." });

    const provider = await LogisticsProvider.findOne({ joinCode: code, active: true });
    if (!provider) return res.status(404).json({ message: "No active company uses that code." });

    req.user.providerId = provider._id;
    await req.user.save();
    await audit(req, "provider.driver_joined", "LogisticsProvider", provider._id, {
      driverId: req.user._id,
    });

    res.json({ message: `You now drive for ${provider.name}.`, provider: provider.toPublic() });
  } catch (error) {
    send(res, error, "JOIN PROVIDER ERROR");
  }
});

// POST /api/logistics/leave
router.post("/leave", protect, requireRole("driver"), async (req, res) => {
  try {
    const previous = req.user.providerId;
    req.user.providerId = null;
    await req.user.save();
    if (previous) {
      await audit(req, "provider.driver_left", "LogisticsProvider", previous, { driverId: req.user._id });
    }
    res.json({ message: "You are now an independent delivery partner." });
  } catch (error) {
    send(res, error, "LEAVE PROVIDER ERROR");
  }
});

module.exports = router;
