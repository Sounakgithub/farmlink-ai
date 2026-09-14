const mongoose = require("mongoose");

/**
 * An append-only record of something consequential happening.
 *
 * Written for order status changes, inspections, money movements, dispute
 * decisions, fee changes, credit approvals and API-key lifecycle events — the
 * things someone will one day need to reconstruct ("who marked this delivered,
 * and when did the refund go out?").
 *
 * Nothing in the application updates or deletes these rows.
 */
const auditLogSchema = new mongoose.Schema(
  {
    // Who did it. Null for the system itself (auto-release sweeps, expiries).
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: "system" },
    actorName: { type: String, default: "FarmLink" },

    // What happened, as a dotted verb: "order.status", "settlement.release".
    action: { type: String, required: true, index: true },

    // What it happened to.
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },

    // Before/after or any structured detail worth keeping.
    details: { type: mongoose.Schema.Types.Mixed, default: {} },

    // How the request arrived: "web", "api-key", "system".
    channel: { type: String, default: "web" },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

// Append-only: refuse updates at the model layer too. Throwing (rather than
// calling next) works on every Mongoose major, including 9 where pre hooks no
// longer receive a callback.
function refuse() {
  throw new Error("Audit log entries are immutable.");
}
auditLogSchema.pre("updateOne", refuse);
auditLogSchema.pre("updateMany", refuse);
auditLogSchema.pre("findOneAndUpdate", refuse);

module.exports = mongoose.model("AuditLog", auditLogSchema);
