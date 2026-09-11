const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const { signToken, protect } = require("../middleware/auth");

const router = express.Router();

const VALID_ROLES = ["farmer", "buyer", "driver"];

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, phone, location } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "Name, email, password and role are all required.",
      });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        message: `Role must be one of: ${VALID_ROLES.join(", ")}.`,
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long.",
      });
    }

    const normalisedEmail = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalisedEmail });

    if (existingUser) {
      return res.status(409).json({
        message: "An account with this email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: String(name).trim(),
      email: normalisedEmail,
      password: hashedPassword,
      role,
      phone: phone || "",
      location: location || "",
    });

    res.status(201).json({
      message: "Registration successful",
      token: signToken(user),
      user: user.toSafeJSON(),
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({
      email: String(email).toLowerCase().trim(),
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    res.json({
      message: "Login successful",
      token: signToken(user),
      user: user.toSafeJSON(),
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/auth/me - used on app boot to restore the session
router.get("/me", protect, (req, res) => {
  res.json({ user: req.user.toSafeJSON() });
});

// Sanitise the optional buyer matching preferences.
//
// Every field is independently optional, and "" / null clears one back to
// "no opinion". Anything unparseable is dropped rather than rejected, so a
// half-filled form still saves the parts that made sense.
const FREQUENCIES = ["daily", "weekly", "fortnightly", "monthly", "occasional", ""];

function cleanPreferences(input, existing = {}) {
  const out = { ...existing };

  const list = (value) =>
    Array.isArray(value)
      ? [...new Set(value.map((v) => String(v || "").trim()).filter(Boolean))].slice(0, 30)
      : [];

  const positive = (value) => {
    if (value === null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined; // undefined = leave as-is
  };

  if (input.preferredCrops !== undefined) out.preferredCrops = list(input.preferredCrops);
  if (input.preferredLocations !== undefined) {
    out.preferredLocations = list(input.preferredLocations);
  }

  for (const key of [
    "minPricePerKg",
    "maxPricePerKg",
    "minQuantityKg",
    "preferredQuantityKg",
    "maxQuantityKg",
  ]) {
    if (input[key] !== undefined) {
      const value = positive(input[key]);
      if (value !== undefined) out[key] = value;
    }
  }

  if (input.purchaseFrequency !== undefined) {
    const freq = String(input.purchaseFrequency || "").toLowerCase().trim();
    if (FREQUENCIES.includes(freq)) out.purchaseFrequency = freq;
  }

  // Keep the ranges the right way round rather than storing a contradiction.
  if (out.minPricePerKg != null && out.maxPricePerKg != null && out.minPricePerKg > out.maxPricePerKg) {
    [out.minPricePerKg, out.maxPricePerKg] = [out.maxPricePerKg, out.minPricePerKg];
  }
  if (out.minQuantityKg != null && out.maxQuantityKg != null && out.minQuantityKg > out.maxQuantityKg) {
    [out.minQuantityKg, out.maxQuantityKg] = [out.maxQuantityKg, out.minQuantityKg];
  }

  return out;
}

// PATCH /api/auth/me - update own profile
// Extended (not replaced) to carry the optional buyer matching preferences,
// so the existing name/phone/location behaviour is untouched.
router.patch("/me", protect, async (req, res) => {
  try {
    const { name, phone, location, buyerPreferences } = req.body;

    if (name !== undefined) req.user.name = String(name).trim();
    if (phone !== undefined) req.user.phone = String(phone).trim();
    if (location !== undefined) req.user.location = String(location).trim();

    if (buyerPreferences !== undefined) {
      if (req.user.role !== "buyer") {
        return res.status(403).json({
          message: "Only a buyer account has matching preferences.",
        });
      }
      if (typeof buyerPreferences !== "object" || buyerPreferences === null) {
        return res.status(400).json({ message: "Preferences must be an object." });
      }

      const current = req.user.buyerPreferences
        ? typeof req.user.buyerPreferences.toObject === "function"
          ? req.user.buyerPreferences.toObject()
          : req.user.buyerPreferences
        : {};

      req.user.buyerPreferences = cleanPreferences(buyerPreferences, current);
    }

    await req.user.save();

    res.json({
      message: "Profile updated",
      user: req.user.toSafeJSON(),
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
