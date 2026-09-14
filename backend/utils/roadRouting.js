const { geocode } = require("./geocode");
const { haversineKm } = require("./routeOptimizer");

/**
 * Real road distance, duration and route shape between two points.
 *
 * Providers, in order of preference:
 *
 *   google     when GOOGLE_MAPS_API_KEY is set - Distance Matrix API.
 *   osrm       the default - an OSRM server at OSRM_URL. Out of the box that
 *              is the public demo at router.project-osrm.org, which is fine
 *              for development but carries a fair-use policy (roughly one
 *              request a second, no bulk use). Point OSRM_URL at a
 *              self-hosted instance for production.
 *   haversine  straight-line distance, used when no provider answers in time
 *              or ROUTING_PROVIDER=haversine. Clearly flagged as approximate.
 *
 * Results are cached for five minutes, as the analysis recommended, so a
 * checkout page re-quoting on every keystroke does not hammer a provider.
 */

const TIMEOUT_MS = Number(process.env.ROUTING_TIMEOUT_MS || 4000);
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

// The planner's own assumption, so a fallback ETA agrees with the route plan.
const FALLBACK_SPEED_KMPH = 28;

const cache = new Map(); // key -> { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    // Drop the oldest entry - Map iterates in insertion order.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), value });
}

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * Turn whatever describes a place into coordinates, or null.
 * Accepts { lat, lng }, { coordinates: { lat, lng } }, or a place name.
 * Never invents a position.
 */
function pointFrom(input) {
  if (!input) return null;
  if (typeof input === "string") {
    const hit = geocode(input);
    return hit ? { lat: hit.lat, lng: hit.lng, source: "geocoded" } : null;
  }
  if (isNum(input.lat) && isNum(input.lng)) {
    return { lat: input.lat, lng: input.lng, source: "coordinates" };
  }
  if (input.coordinates && isNum(input.coordinates.lat) && isNum(input.coordinates.lng)) {
    return { lat: input.coordinates.lat, lng: input.coordinates.lng, source: "coordinates" };
  }
  const name = input.location || input.place || input.city;
  return name ? pointFrom(String(name)) : null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FarmLink-AI/1.0 (delivery routing)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function viaOsrm(from, to) {
  const base = (process.env.OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
  // OSRM takes lng,lat.
  const url =
    `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    "?overview=simplified&geometries=geojson";
  const data = await fetchJson(url);
  const route = data && data.code === "Ok" && data.routes && data.routes[0];
  if (!route) throw new Error(`OSRM: ${data?.code || "no route"}`);

  return {
    distanceKm: Math.round((route.distance / 1000) * 10) / 10,
    durationMin: Math.round(route.duration / 60),
    // GeoJSON is [lng, lat]; the map wants [lat, lng].
    geometry: (route.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    source: "osrm",
    approximate: false,
  };
}

async function viaGoogle(from, to) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${from.lat},${from.lng}&destinations=${to.lat},${to.lng}` +
    `&mode=driving&key=${encodeURIComponent(key)}`;
  const data = await fetchJson(url);
  const element = data?.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") {
    throw new Error(`Google: ${element?.status || data?.status || "no result"}`);
  }
  return {
    distanceKm: Math.round((element.distance.value / 1000) * 10) / 10,
    durationMin: Math.round(element.duration.value / 60),
    // Distance Matrix returns no shape; the map draws a straight guide instead.
    geometry: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    source: "google",
    approximate: false,
  };
}

function viaHaversine(from, to, reason) {
  const km = haversineKm(from, to);
  return {
    distanceKm: Math.round(km * 10) / 10,
    durationMin: Math.round((km / FALLBACK_SPEED_KMPH) * 60),
    geometry: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    source: "haversine",
    approximate: true,
    fallbackReason: reason || undefined,
  };
}

function chosenProvider() {
  const raw = String(process.env.ROUTING_PROVIDER || "").toLowerCase().trim();
  const forced = raw === "auto" ? "" : raw;
  if (forced === "haversine") return "haversine";
  if (forced === "google" || (!forced && process.env.GOOGLE_MAPS_API_KEY)) return "google";
  return "osrm";
}

/**
 * Road route between two places.
 * @returns {Promise<{distanceKm, durationMin, geometry, source, approximate, from, to}|null>}
 *          null only when a place cannot be located at all.
 */
async function roadRoute(fromInput, toInput) {
  const from = pointFrom(fromInput);
  const to = pointFrom(toInput);
  if (!from || !to) return null;

  const provider = chosenProvider();
  const key = [
    provider,
    from.lat.toFixed(4),
    from.lng.toFixed(4),
    to.lat.toFixed(4),
    to.lng.toFixed(4),
  ].join(":");

  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  let result;
  if (provider === "haversine") {
    result = viaHaversine(from, to);
  } else {
    try {
      result = provider === "google" ? await viaGoogle(from, to) : await viaOsrm(from, to);
    } catch (error) {
      result = viaHaversine(from, to, `${provider} unavailable: ${error.message}`);
    }
  }

  const value = {
    ...result,
    from: { lat: from.lat, lng: from.lng, source: from.source },
    to: { lat: to.lat, lng: to.lng, source: to.source },
  };

  // Only cache real answers; a fallback should retry the provider next time.
  if (!result.fallbackReason) cacheSet(key, value);
  return value;
}

function clearRoutingCache() {
  cache.clear();
}

module.exports = { roadRoute, pointFrom, clearRoutingCache, chosenProvider };
