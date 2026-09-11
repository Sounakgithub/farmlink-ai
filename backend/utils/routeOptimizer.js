// Delivery route optimisation.
//
// Solves the (small) travelling-salesman problem a single driver faces:
// starting from a depot, visit every delivery stop once with the least total
// travel distance, optionally returning to the depot.
//
// Approach: build a haversine distance matrix, get an initial tour with the
// nearest-neighbour heuristic, then improve it to a local optimum with 2-opt.
// For the handful of stops a driver has per run this is effectively optimal
// and runs in well under a millisecond.

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function pathCost(order, matrix, roundTrip) {
  let cost = 0;
  for (let i = 0; i < order.length - 1; i++) {
    cost += matrix[order[i]][order[i + 1]];
  }
  if (roundTrip && order.length > 1) {
    cost += matrix[order[order.length - 1]][order[0]];
  }
  return cost;
}

function nearestNeighbour(matrix) {
  const n = matrix.length;
  const order = [0];
  const visited = new Set([0]);
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited.has(i) && matrix[last][i] < bestDist) {
        bestDist = matrix[last][i];
        best = i;
      }
    }
    order.push(best);
    visited.add(best);
  }
  return order;
}

// 2-opt: repeatedly reverse a sub-path if doing so shortens the tour.
// Index 0 (the depot) is held fixed as the start.
function twoOpt(order, matrix, roundTrip) {
  let best = order.slice();
  let bestCost = pathCost(best, matrix, roundTrip);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best
          .slice(0, i)
          .concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const cost = pathCost(candidate, matrix, roundTrip);
        if (cost + 1e-9 < bestCost) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * @param {Object}   opts
 * @param {{lat,lng,label?}}        opts.start   depot / driver start point
 * @param {Array<{lat,lng,...}>}    opts.stops   delivery stops
 * @param {boolean}  [opts.roundTrip=false]      return to the depot at the end
 * @param {number}   [opts.speedKmph=28]         average driving speed
 * @param {number}   [opts.serviceMinutesPerStop=8]
 * @returns {Object} optimised plan
 */
function optimizeRoute({
  start,
  stops,
  roundTrip = false,
  speedKmph = 28,
  serviceMinutesPerStop = 8,
}) {
  if (!start || !Array.isArray(stops) || stops.length === 0) {
    throw new Error("optimizeRoute requires a start point and at least one stop");
  }

  const points = [start, ...stops];
  const matrix = points.map((a) => points.map((b) => haversineKm(a, b)));

  const naiveOrder = points.map((_, i) => i); // depot, then stops as supplied
  const naiveDistance = pathCost(naiveOrder, matrix, roundTrip);

  let order = nearestNeighbour(matrix);
  order = twoOpt(order, matrix, roundTrip);

  const sequence = roundTrip ? [...order, 0] : order;

  const legs = [];
  let totalDistanceKm = 0;
  let totalDrivingMin = 0;

  for (let i = 0; i < sequence.length - 1; i++) {
    const fromIdx = sequence[i];
    const toIdx = sequence[i + 1];
    const distanceKm = matrix[fromIdx][toIdx];
    const drivingMin = (distanceKm / speedKmph) * 60;
    totalDistanceKm += distanceKm;
    totalDrivingMin += drivingMin;
    legs.push({
      from: points[fromIdx].label || (fromIdx === 0 ? "Depot" : `Stop ${fromIdx}`),
      to: points[toIdx].label || (toIdx === 0 ? "Depot" : `Stop ${toIdx}`),
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Math.round(drivingMin),
    });
  }

  const serviceMin = stops.length * serviceMinutesPerStop;
  const orderedStops = order
    .filter((idx) => idx !== 0)
    .map((idx, position) => ({
      sequence: position + 1,
      ...stops[idx - 1],
    }));

  const waypoints = sequence.map((idx) => ({
    lat: points[idx].lat,
    lng: points[idx].lng,
    label: points[idx].label || (idx === 0 ? "Depot" : `Stop ${idx}`),
  }));

  return {
    start: { lat: start.lat, lng: start.lng, label: start.label || "Depot" },
    roundTrip,
    stopCount: stops.length,
    order: orderedStops,
    legs,
    waypoints,
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    drivingTimeMin: Math.round(totalDrivingMin),
    serviceTimeMin: serviceMin,
    totalTimeMin: Math.round(totalDrivingMin + serviceMin),
    naiveDistanceKm: Number(naiveDistance.toFixed(2)),
    distanceSavedKm: Number(Math.max(0, naiveDistance - totalDistanceKm).toFixed(2)),
    improvementPct:
      naiveDistance > 0
        ? Number((((naiveDistance - totalDistanceKm) / naiveDistance) * 100).toFixed(1))
        : 0,
    assumptions: { speedKmph, serviceMinutesPerStop },
  };
}

// ---------------------------------------------------------------------------
// Pickup-and-delivery routing
//
// A delivery run is not a plain travelling-salesman tour. Every order is two
// linked stops - collect from the farm, drop at the address the buyer gave -
// and the collection has to happen first. A plain TSP will happily plan the
// drop before the pickup, which looks shorter and is physically impossible.
//
// So the same nearest-neighbour + 2-opt approach is used, but every candidate
// tour is checked against the precedence rule and rejected if it breaks it.
// ---------------------------------------------------------------------------

// A tour is legal when every pickup appears before its own dropoff.
function precedenceHolds(order, meta) {
  const collected = new Set();
  for (const nodeIndex of order) {
    const node = meta[nodeIndex];
    if (!node) continue; // the start point
    if (node.type === "pickup") {
      collected.add(node.jobIndex);
    } else if (!collected.has(node.jobIndex)) {
      return false;
    }
  }
  return true;
}

// Nearest neighbour that only steps to a node it is allowed to visit yet.
function nearestNeighbourWithPrecedence(matrix, meta) {
  const n = matrix.length;
  const order = [0];
  const visited = new Set([0]);
  const collected = new Set();

  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestDist = Infinity;

    for (let i = 1; i < n; i++) {
      if (visited.has(i)) continue;
      // a dropoff only becomes reachable once its pickup is done
      if (meta[i].type === "dropoff" && !collected.has(meta[i].jobIndex)) continue;
      if (matrix[last][i] < bestDist) {
        bestDist = matrix[last][i];
        best = i;
      }
    }

    // Unreachable in practice (every dropoff has a pickup), but never spin.
    if (best === -1) {
      best = [...Array(n).keys()].find((i) => !visited.has(i));
      if (best === undefined) break;
    }

    if (meta[best].type === "pickup") collected.add(meta[best].jobIndex);
    order.push(best);
    visited.add(best);
  }
  return order;
}

function twoOptWithPrecedence(order, matrix, meta, roundTrip) {
  let best = order.slice();
  let bestCost = pathCost(best, matrix, roundTrip);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best
          .slice(0, i)
          .concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));

        // Reversing a segment can flip a pickup behind its own dropoff.
        if (!precedenceHolds(candidate, meta)) continue;

        const cost = pathCost(candidate, matrix, roundTrip);
        if (cost + 1e-9 < bestCost) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Plan a driver run over pickup/dropoff pairs.
 *
 * @param {Object} opts
 * @param {{lat,lng,label?}} opts.start  where the driver begins
 * @param {Array<{orderId?, pickup:{lat,lng,label?}, dropoff:{lat,lng,label?}}>} opts.jobs
 * @param {boolean} [opts.roundTrip=false]
 * @param {number}  [opts.speedKmph=28]
 * @param {number}  [opts.serviceMinutesPerStop=8]
 * @returns {Object} plan with an interleaved, precedence-safe stop list
 */
function optimizePickupDelivery({
  start,
  jobs,
  roundTrip = false,
  speedKmph = 28,
  serviceMinutesPerStop = 8,
}) {
  if (!start || !Array.isArray(jobs) || jobs.length === 0) {
    throw new Error("optimizePickupDelivery requires a start point and at least one job");
  }

  // Flatten every job into two nodes, remembering which is which.
  const points = [start];
  const meta = [null]; // index 0 is the start point

  jobs.forEach((job, jobIndex) => {
    points.push(job.pickup);
    meta.push({ jobIndex, type: "pickup" });
    points.push(job.dropoff);
    meta.push({ jobIndex, type: "dropoff" });
  });

  const matrix = points.map((a) => points.map((b) => haversineKm(a, b)));

  // Baseline: the obvious plan a person makes without any optimisation -
  // run each order start to finish, in the order they arrived.
  const naiveOrder = [0];
  jobs.forEach((_, jobIndex) => {
    naiveOrder.push(1 + jobIndex * 2, 2 + jobIndex * 2);
  });
  const naiveDistance = pathCost(naiveOrder, matrix, roundTrip);

  // Multi-start. Precedence rejects a lot of the 2-opt moves that would
  // otherwise be available, so a nearest-neighbour seed can polish into a tour
  // that is WORSE than simply doing each order start-to-finish. Improving both
  // seeds and keeping the better one means the plan we return is never worse
  // than the obvious plan a person would have made unaided.
  const candidates = [
    twoOptWithPrecedence(nearestNeighbourWithPrecedence(matrix, meta), matrix, meta, roundTrip),
    twoOptWithPrecedence(naiveOrder, matrix, meta, roundTrip),
  ].filter((candidate) => precedenceHolds(candidate, meta));

  // Never hand back an impossible plan, even if a future change to the
  // heuristics slips one through.
  let order = naiveOrder;
  let orderCost = naiveDistance;
  for (const candidate of candidates) {
    const cost = pathCost(candidate, matrix, roundTrip);
    if (cost < orderCost) {
      order = candidate;
      orderCost = cost;
    }
  }

  const sequence = roundTrip ? [...order, 0] : order;

  const legs = [];
  let totalDistanceKm = 0;
  let totalDrivingMin = 0;

  for (let i = 0; i < sequence.length - 1; i++) {
    const fromIdx = sequence[i];
    const toIdx = sequence[i + 1];
    const distanceKm = matrix[fromIdx][toIdx];
    const drivingMin = (distanceKm / speedKmph) * 60;
    totalDistanceKm += distanceKm;
    totalDrivingMin += drivingMin;
    legs.push({
      from: points[fromIdx].label || (fromIdx === 0 ? "Start" : `Stop ${fromIdx}`),
      to: points[toIdx].label || (toIdx === 0 ? "Start" : `Stop ${toIdx}`),
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Math.round(drivingMin),
    });
  }

  // Walk the tour again so every stop carries a running distance and ETA, and
  // the UI can say "3rd stop, about 40 minutes out" without recomputing.
  const stops = [];
  let runningKm = 0;
  let runningMin = 0;

  for (let i = 1; i < order.length; i++) {
    const nodeIndex = order[i];
    const node = meta[nodeIndex];
    const job = jobs[node.jobIndex];
    const point = points[nodeIndex];

    runningKm += matrix[order[i - 1]][nodeIndex];
    runningMin += (matrix[order[i - 1]][nodeIndex] / speedKmph) * 60;

    stops.push({
      sequence: i,
      type: node.type,
      orderId: job.orderId,
      label: point.label,
      lat: point.lat,
      lng: point.lng,
      approxLocation: !!point.approxLocation,
      place: point.place,
      crop: job.crop,
      buyerName: job.buyerName,
      farmerName: job.farmerName,
      amount: job.amount,
      status: job.status,
      cumulativeKm: Number(runningKm.toFixed(2)),
      etaMinutes: Math.round(runningMin),
    });

    runningMin += serviceMinutesPerStop;
  }

  const waypoints = sequence.map((idx) => ({
    lat: points[idx].lat,
    lng: points[idx].lng,
    label: points[idx].label || (idx === 0 ? "Start" : `Stop ${idx}`),
    type: meta[idx] ? meta[idx].type : "start",
  }));

  return {
    start: { lat: start.lat, lng: start.lng, label: start.label || "Start" },
    roundTrip,
    jobCount: jobs.length,
    stopCount: stops.length,
    stops,
    legs,
    waypoints,
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    drivingTimeMin: Math.round(totalDrivingMin),
    serviceTimeMin: stops.length * serviceMinutesPerStop,
    totalTimeMin: Math.round(totalDrivingMin + stops.length * serviceMinutesPerStop),
    naiveDistanceKm: Number(naiveDistance.toFixed(2)),
    distanceSavedKm: Number(Math.max(0, naiveDistance - totalDistanceKm).toFixed(2)),
    improvementPct:
      naiveDistance > 0
        ? Number((((naiveDistance - totalDistanceKm) / naiveDistance) * 100).toFixed(1))
        : 0,
    assumptions: { speedKmph, serviceMinutesPerStop },
    algorithm: "nearest-neighbour + 2-opt with pickup-before-dropoff precedence",
  };
}

module.exports = {
  optimizeRoute,
  optimizePickupDelivery,
  precedenceHolds,
  haversineKm,
};
