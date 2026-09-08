const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "farmlink_dev_secret";
const TOKEN_TTL = "7d";

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

function readToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

// Hard gate: request fails unless a valid token is present.
async function protect(req, res, next) {
  const token = readToken(req);

  if (!token) {
    return res.status(401).json({ message: "Please log in to continue." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: "Your session is no longer valid." });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
}

// Soft gate: attaches req.user when a valid token exists, but never blocks.
async function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id);
  } catch {
    // ignore - route stays public
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Please log in to continue." });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `This action is only available to a ${roles.join(" or ")} account.`,
      });
    }
    next();
  };
}

module.exports = { signToken, protect, optionalAuth, requireRole };
