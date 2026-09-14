const Inspection = require("../models/Inspection");
const { GRADES, CONDITIONS } = require("../models/Inspection");
const { audit } = require("./audit");
const { getSettings } = require("./settings");
const settlement = require("./settlement");

/**
 * Quality inspection: the rules, and the two recording flows.
 *
 * The rules are pure functions so they can be unit-tested without a database.
 * The record* functions apply them to a real order and move it forward.
 */

const httpError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

const cleanPhotos = (photos) =>
  (Array.isArray(photos) ? photos : [])
    .map((p) => String(p || "").trim())
    .filter((p) => /^https?:\/\//i.test(p))
    .slice(0, 8);

const orderedKg = (order) =>
  order.products.reduce((total, line) => total + (Number(line.quantity) || 0), 0);

// ===========================================================================
// Pure rules
// ===========================================================================

/**
 * Judge a pickup inspection.
 * @returns {{ result: "passed"|"failed", reasons: string[], problems: string[] }}
 *          `problems` are input errors - the inspection cannot be recorded.
 */
function evaluatePickup(input, { weightTolerancePct = 5 } = {}) {
  const problems = [];
  const reasons = [];

  const grade = String(input.grade || "").toUpperCase();
  if (!GRADES.includes(grade)) {
    problems.push(`Grade must be one of ${GRADES.join(", ")}.`);
  }

  const checks = input.checks || {};
  const notes = String(input.notes || "").trim();
  const photos = cleanPhotos(input.photos);

  if (grade === "REJECT") reasons.push("Graded REJECT at the farm gate.");
  if (checks.freshness === false) reasons.push("Produce failed the freshness check.");
  if (checks.pestFree === false) reasons.push("Pest damage or infestation found.");

  const expectedKg = Number(input.expectedKg);
  const measuredKg = input.measuredKg === undefined || input.measuredKg === null
    ? null
    : Number(input.measuredKg);

  if (measuredKg !== null && (!Number.isFinite(measuredKg) || measuredKg < 0)) {
    problems.push("Measured weight must be a positive number of kg.");
  } else if (measuredKg !== null && Number.isFinite(expectedKg) && expectedKg > 0) {
    const floor = expectedKg * (1 - weightTolerancePct / 100);
    if (measuredKg < floor) {
      reasons.push(
        `Short weight: ${measuredKg} kg loaded against ${expectedKg} kg ordered ` +
          `(more than the ${weightTolerancePct}% tolerance).`
      );
    }
  }

  const failed = reasons.length > 0;

  // A failure stops a sale, so it has to be evidenced.
  if (failed && notes.length < 5) {
    problems.push("Explain the failure in the notes - it will be shown to the farmer.");
  }
  if (grade === "REJECT" && photos.length === 0) {
    problems.push("A REJECT grade needs at least one photo as evidence.");
  }

  // Worth recording, but not a reason to stop the shipment.
  const advisories = [];
  if (checks.packaging === false) advisories.push("Packaging needs attention.");
  if (checks.moistureOk === false) advisories.push("Moisture outside the usual range.");

  return {
    result: failed ? "failed" : "passed",
    reasons: failed ? reasons : advisories,
    problems,
    grade,
    measuredKg,
    photos,
    notes,
  };
}

/**
 * Judge the buyer's delivery check.
 * @returns {{ result: "passed"|"disputed", reasons, problems }}
 */
function evaluateDelivery(input, { expectedKg, weightTolerancePct = 5 } = {}) {
  const problems = [];
  const reasons = [];

  const condition = String(input.condition || "").toLowerCase();
  if (!CONDITIONS.includes(condition)) {
    problems.push(`Condition must be one of ${CONDITIONS.join(", ")}.`);
  }

  const notes = String(input.notes || "").trim();
  const photos = cleanPhotos(input.photos);

  const receivedKg = input.receivedKg === undefined || input.receivedKg === null
    ? null
    : Number(input.receivedKg);

  if (receivedKg !== null && (!Number.isFinite(receivedKg) || receivedKg < 0)) {
    problems.push("Received weight must be a positive number of kg.");
  }

  if (condition === "damaged") reasons.push("Buyer reports the produce arrived damaged.");
  if (condition === "spoiled") reasons.push("Buyer reports the produce arrived spoiled.");
  if (condition === "short") reasons.push("Buyer reports receiving less than ordered.");

  if (
    receivedKg !== null &&
    Number.isFinite(expectedKg) &&
    expectedKg > 0 &&
    receivedKg < expectedKg * (1 - weightTolerancePct / 100) &&
    condition === "good"
  ) {
    reasons.push(`Only ${receivedKg} kg received against ${expectedKg} kg ordered.`);
  }

  const disputed = reasons.length > 0;
  if (disputed && notes.length < 5) {
    problems.push("Describe the problem in the notes so it can be reviewed.");
  }

  return {
    result: disputed ? "disputed" : "passed",
    reasons,
    problems,
    condition,
    receivedKg,
    photos,
    notes,
  };
}

/**
 * Who carries a loss, from the chain of custody.
 *
 * The logic is the one a claims desk would apply: if the goods left the farm
 * in acceptable condition and arrived damaged, the carrier had them when it
 * happened. If they were already marginal at the gate, the loss is shared.
 * Without a pickup record there is no evidence either way.
 */
function determineLiability(pickup, delivery, { weightTolerancePct = 5 } = {}) {
  if (!delivery || delivery.result === "passed") {
    return { liability: "none", reason: "Delivered in good condition." };
  }

  if (!pickup) {
    return {
      liability: "undetermined",
      reason: "No pickup inspection was recorded, so there is no evidence of the condition at collection.",
    };
  }

  if (pickup.result === "failed") {
    return { liability: "farmer", reason: "The goods failed inspection at the farm." };
  }

  // Weight lost between the scale at the farm and the scale at the door.
  const loaded = pickup.measuredKg ?? pickup.expectedKg;
  const received = delivery.measuredKg;
  const lostInTransit =
    Number.isFinite(loaded) &&
    Number.isFinite(received) &&
    received < loaded * (1 - weightTolerancePct / 100);

  if (lostInTransit && !["damaged", "spoiled"].includes(delivery.condition)) {
    return {
      liability: "logistics",
      reason: `${loaded} kg was weighed onto the vehicle but only ${received} kg arrived.`,
    };
  }

  if (delivery.condition === "short") {
    return {
      liability: "undetermined",
      reason: Number.isFinite(received)
        ? "Reported short, but the received weight is within tolerance of what was loaded."
        : "Reported short without a received weight to compare against.",
    };
  }

  if (["damaged", "spoiled"].includes(delivery.condition)) {
    if (pickup.grade === "C") {
      return {
        liability: "shared",
        reason: "The produce was only grade C at collection and deteriorated in transit.",
      };
    }
    return {
      liability: "logistics",
      reason: `The produce left the farm at grade ${pickup.grade} and arrived ${delivery.condition}.`,
    };
  }

  return { liability: "undetermined", reason: "The reported problem needs a manual review." };
}

// ===========================================================================
// Recording flows
// ===========================================================================

/**
 * May this user record the pickup inspection for this order?
 * The collecting driver (the assigned one, a driver of the assigned carrier,
 * or - for the open independent pool - any driver), or an admin inspector.
 */
function canInspectPickup(order, user) {
  if (user.role === "admin") return true;
  if (user.role !== "driver") return false;

  if (order.logistics?.mode === "provider") {
    return (
      String(order.driverId) === String(user._id) ||
      (user.providerId && String(user.providerId) === String(order.logistics.providerId))
    );
  }
  // Independent pool: the assigned driver, or whoever turns up to collect.
  return true;
}

/**
 * Record a pickup inspection and apply its consequences.
 * Mutates and saves the order. Throws an http-shaped error on bad input.
 */
async function recordPickupInspection(order, req, input) {
  if (!["Accepted", "Confirmed"].includes(order.status)) {
    throw httpError(409, `A pickup inspection is only taken before the goods leave (order is ${order.status}).`);
  }
  if (!canInspectPickup(order, req.user)) {
    throw httpError(403, "Only the collecting driver or an admin inspector can inspect this pickup.");
  }
  if (order.inspection?.pickup?.result) {
    throw httpError(409, "This order has already been inspected at pickup.", {
      inspection: order.inspection.pickup,
    });
  }

  const settings = await getSettings();
  const expectedKg = orderedKg(order);
  const verdict = evaluatePickup(
    { ...input, expectedKg },
    { weightTolerancePct: settings.inspection.weightTolerancePct }
  );

  if (verdict.problems.length) {
    throw httpError(400, verdict.problems[0], { problems: verdict.problems });
  }

  let inspection;
  try {
    inspection = await Inspection.create({
      orderId: order._id,
      stage: "pickup",
      farmerIds: order.farmerIds(),
      inspectorId: req.user._id,
      inspectorRole: req.user.role,
      inspectorName: req.user.name,
      grade: verdict.grade,
      checks: {
        freshness: input.checks?.freshness ?? null,
        packaging: input.checks?.packaging ?? null,
        pestFree: input.checks?.pestFree ?? null,
        moistureOk: input.checks?.moistureOk ?? null,
      },
      expectedKg,
      measuredKg: verdict.measuredKg,
      notes: verdict.notes,
      photos: verdict.photos,
      result: verdict.result,
      reasons: verdict.reasons,
    });
  } catch (error) {
    if (error.code === 11000) {
      throw httpError(409, "This order has already been inspected at pickup.");
    }
    throw error;
  }

  const summary = {
    ...(order.inspection?.toObject ? order.inspection.toObject() : order.inspection || {}),
    pickup: {
      id: inspection._id,
      result: verdict.result,
      grade: verdict.grade,
      at: inspection.createdAt,
    },
  };

  if (verdict.result === "failed") {
    // The goods never ship. The buyer is refunded in full; the stock is not
    // put back on sale, because the lot itself is what failed.
    summary.liability = "farmer";
    summary.liabilityReason = verdict.reasons.join(" ");
    order.inspection = summary;
    order.status = "Rejected";
    order.statusHistory.push({ status: "Rejected", by: `quality inspection (${req.user.name})` });
    if (order.paymentStatus === "Paid") order.paymentStatus = "Refunded";
    await settlement.onOrderVoided(order, req, "failed pickup quality inspection");
  } else {
    order.inspection = summary;
    // In the open pool, whoever inspects is the one collecting.
    if (req.user.role === "driver" && !order.driverId) order.driverId = req.user._id;
  }

  await order.save();

  await audit(req, "inspection.pickup", "Order", order._id, {
    inspectionId: inspection._id,
    result: verdict.result,
    grade: verdict.grade,
    reasons: verdict.reasons,
  });

  return { inspection, verdict };
}

/**
 * Record the buyer's delivery check and move the money accordingly.
 * Mutates and saves the order.
 */
async function recordDeliveryInspection(order, req, input) {
  if (req.user.role !== "buyer" || String(order.buyerId) !== String(req.user._id)) {
    throw httpError(403, "Only the buyer who placed this order can confirm its delivery.");
  }
  if (order.status !== "Delivered") {
    throw httpError(409, "Delivery can only be confirmed once the order has been delivered.");
  }
  if (order.inspection?.delivery?.result) {
    throw httpError(409, "Delivery has already been confirmed for this order.", {
      inspection: order.inspection.delivery,
    });
  }

  const settings = await getSettings();
  const expectedKg = orderedKg(order);
  const verdict = evaluateDelivery(input, {
    expectedKg,
    weightTolerancePct: settings.inspection.weightTolerancePct,
  });

  if (verdict.problems.length) {
    throw httpError(400, verdict.problems[0], { problems: verdict.problems });
  }

  let inspection;
  try {
    inspection = await Inspection.create({
      orderId: order._id,
      stage: "delivery",
      farmerIds: order.farmerIds(),
      inspectorId: req.user._id,
      inspectorRole: req.user.role,
      inspectorName: req.user.name,
      condition: verdict.condition,
      expectedKg,
      measuredKg: verdict.receivedKg,
      notes: verdict.notes,
      photos: verdict.photos,
      result: verdict.result,
      reasons: verdict.reasons,
    });
  } catch (error) {
    if (error.code === 11000) {
      throw httpError(409, "Delivery has already been confirmed for this order.");
    }
    throw error;
  }

  const pickup = order.inspection?.pickup?.id
    ? await Inspection.findById(order.inspection.pickup.id).lean()
    : null;

  const { liability, reason } = determineLiability(pickup, inspection.toObject(), {
    weightTolerancePct: settings.inspection.weightTolerancePct,
  });

  order.inspection = {
    ...(order.inspection?.toObject ? order.inspection.toObject() : order.inspection || {}),
    delivery: {
      id: inspection._id,
      result: verdict.result,
      condition: verdict.condition,
      at: inspection.createdAt,
    },
    liability,
    liabilityReason: reason,
  };

  let released = null;
  if (verdict.result === "passed") {
    // Good condition: pay everyone now rather than waiting out the window.
    if (order.settlement?.status === "held") {
      released = await settlement.release(order, req, "buyer confirmed good condition");
    }
  } else {
    await settlement.openDispute(order, req, { liability, reason });
  }

  await order.save();

  await audit(req, "inspection.delivery", "Order", order._id, {
    inspectionId: inspection._id,
    result: verdict.result,
    condition: verdict.condition,
    liability,
  });

  return { inspection, verdict, liability, liabilityReason: reason, released };
}

module.exports = {
  evaluatePickup,
  evaluateDelivery,
  determineLiability,
  canInspectPickup,
  recordPickupInspection,
  recordDeliveryInspection,
  orderedKg,
};
