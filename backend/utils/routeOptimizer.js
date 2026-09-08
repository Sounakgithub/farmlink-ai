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

module.exports = { optimizeRoute, haversineKm };
