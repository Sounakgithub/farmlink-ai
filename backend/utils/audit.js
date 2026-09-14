const AuditLog = require("../models/AuditLog");

/**
 * Record something consequential.
 *
 * Never throws: an audit write failing must not roll back the action it
 * describes. A failure is logged loudly instead, because a silently missing
 * audit trail is its own problem.
 *
 * @param {object} req      the request (for actor, channel, ip) - or null for system actions
 * @param {string} action   dotted verb, e.g. "order.status"
 * @param {string} entityType
 * @param {*}      entityId
 * @param {object} details
 */
async function audit(req, action, entityType, entityId, details = {}) {
  try {
    const actor = req && req.user;
    await AuditLog.create({
      actorId: actor ? actor._id : null,
      actorRole: actor ? actor.role : "system",
      actorName: actor ? actor.name : "FarmLink",
      action,
      entityType,
      entityId: entityId || undefined,
      details,
      channel: req ? (req.apiKey ? "api-key" : "web") : "system",
      ip: req ? String(req.ip || req.headers?.["x-forwarded-for"] || "") : "",
    });
  } catch (error) {
    console.error(`AUDIT WRITE FAILED [${action}]:`, error.message);
  }
}

module.exports = { audit };
