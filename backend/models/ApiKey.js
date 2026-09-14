const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * A partner API key for the public /api/v1 surface.
 *
 * The secret is shown to its owner exactly once, at creation. What is stored
 * is a short public prefix (to find the row) and a SHA-256 hash of the full
 * key (to verify it) - so a database leak does not leak working keys.
 */

const SCOPES = ["products:read", "quotes:write", "orders:write", "orders:read"];

const apiKeySchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: { type: String, required: true, trim: true, maxlength: 80 },

    // e.g. "fl_live_3f9a1c2b" - safe to display, identifies the key.
    prefix: { type: String, required: true, unique: true },
    keyHash: { type: String, required: true },

    scopes: {
      type: [String],
      default: SCOPES,
      validate: {
        validator: (list) => list.every((s) => SCOPES.includes(s)),
        message: `Scopes must be drawn from: ${SCOPES.join(", ")}.`,
      },
    },

    rateLimitPerMinute: { type: Number, min: 1, max: 6000, default: 60 },

    lastUsedAt: { type: Date, default: null },
    usageCount: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const hashKey = (plaintext) =>
  crypto.createHash("sha256").update(String(plaintext)).digest("hex");

/**
 * Mint a new key. Returns { plaintext, doc } - the plaintext must be handed to
 * the owner immediately; it cannot be recovered afterwards.
 */
apiKeySchema.statics.mint = async function mint({ ownerId, name, scopes, rateLimitPerMinute }) {
  const publicPart = crypto.randomBytes(4).toString("hex");
  const secretPart = crypto.randomBytes(24).toString("hex");
  const prefix = `fl_live_${publicPart}`;
  const plaintext = `${prefix}_${secretPart}`;

  const doc = await this.create({
    ownerId,
    name,
    prefix,
    keyHash: hashKey(plaintext),
    ...(Array.isArray(scopes) && scopes.length ? { scopes } : {}),
    ...(rateLimitPerMinute ? { rateLimitPerMinute } : {}),
  });

  return { plaintext, doc };
};

/** Constant-time check of a presented key against this row. */
apiKeySchema.methods.matches = function matches(plaintext) {
  const presented = Buffer.from(hashKey(plaintext), "hex");
  const stored = Buffer.from(this.keyHash, "hex");
  return presented.length === stored.length && crypto.timingSafeEqual(presented, stored);
};

apiKeySchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id,
    name: this.name,
    prefix: this.prefix,
    scopes: this.scopes,
    rateLimitPerMinute: this.rateLimitPerMinute,
    lastUsedAt: this.lastUsedAt,
    usageCount: this.usageCount,
    revoked: !!this.revokedAt,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("ApiKey", apiKeySchema);
module.exports.SCOPES = SCOPES;
module.exports.hashKey = hashKey;
