const ApiKey = require("../models/ApiKey");
const User = require("../models/User");

/**
 * Partner API authentication for /api/v1.
 *
 * Reads `X-API-Key: fl_live_<public>_<secret>`, finds the key by its public
 * prefix, verifies the full key against the stored hash in constant time,
 * enforces the key's scope and per-minute rate limit, and attaches the owning
 * user so the partner acts exactly as that business account would.
 *
 * Rate limiting is an in-memory sliding window per key. That is correct for a
 * single API process; a multi-instance deployment needs a shared store such
 * as Redis for the counts to be global.
 */

const windows = new Map(); // keyId -> number[] of request timestamps

function allowRequest(keyId, limitPerMinute) {
  const now = Date.now();
  const cutoff = now - 60_000;
  const hits = (windows.get(keyId) || []).filter((t) => t > cutoff);

  if (hits.length >= limitPerMinute) {
    windows.set(keyId, hits);
    const retryAfterMs = Math.max(0, hits[0] + 60_000 - now);
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  hits.push(now);
  windows.set(keyId, hits);
  return { allowed: true, remaining: limitPerMinute - hits.length };
}

function requireApiKey(...scopes) {
  return async (req, res, next) => {
    try {
      const presented = String(req.headers["x-api-key"] || "").trim();
      const match = presented.match(/^(fl_live_[0-9a-f]{8})_[0-9a-f]{48}$/);

      if (!match) {
        return res.status(401).json({
          error: "invalid_api_key",
          message: "Send a valid key in the X-API-Key header.",
        });
      }

      const key = await ApiKey.findOne({ prefix: match[1] });
      if (!key || !key.matches(presented)) {
        return res.status(401).json({ error: "invalid_api_key", message: "Unknown API key." });
      }
      if (key.revokedAt) {
        return res.status(401).json({ error: "revoked_api_key", message: "This API key has been revoked." });
      }

      const missing = scopes.filter((s) => !key.scopes.includes(s));
      if (missing.length) {
        return res.status(403).json({
          error: "insufficient_scope",
          message: `This key lacks the ${missing.join(", ")} scope.`,
        });
      }

      const limit = allowRequest(String(key._id), key.rateLimitPerMinute);
      res.setHeader("X-RateLimit-Limit", key.rateLimitPerMinute);
      res.setHeader("X-RateLimit-Remaining", limit.remaining);
      if (!limit.allowed) {
        res.setHeader("Retry-After", limit.retryAfterSec);
        return res.status(429).json({
          error: "rate_limited",
          message: `Rate limit of ${key.rateLimitPerMinute} requests per minute exceeded.`,
          retryAfterSec: limit.retryAfterSec,
        });
      }

      const owner = await User.findById(key.ownerId);
      if (!owner || owner.role !== "buyer" || owner.accountType !== "business") {
        return res.status(403).json({
          error: "owner_not_eligible",
          message: "API access is limited to business buyer accounts.",
        });
      }

      // Usage bookkeeping never blocks the request.
      ApiKey.updateOne(
        { _id: key._id },
        { $set: { lastUsedAt: new Date() }, $inc: { usageCount: 1 } }
      ).catch(() => {});

      req.user = owner;
      req.apiKey = key;
      next();
    } catch (error) {
      console.error("API KEY AUTH ERROR:", error);
      res.status(500).json({ error: "server_error", message: "Could not authenticate the request." });
    }
  };
}

function resetRateLimits() {
  windows.clear();
}

module.exports = { requireApiKey, allowRequest, resetRateLimits };
