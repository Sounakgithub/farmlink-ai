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

// PATCH /api/auth/me - update own profile
router.patch("/me", protect, async (req, res) => {
  try {
    const { name, phone, location } = req.body;

    if (name !== undefined) req.user.name = String(name).trim();
    if (phone !== undefined) req.user.phone = String(phone).trim();
    if (location !== undefined) req.user.location = String(location).trim();

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
