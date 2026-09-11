// Server-side client for the Flask ML service (ml-service/app.py).
//
// The matching engine wants a demand signal, but demand is only 10 of the 100
// match points - it must never be able to take the whole feature down. So
// every call here:
//
//   * has a hard timeout (the ML service may be starting, or simply not run),
//   * never throws - a failure returns null and the caller substitutes a
//     neutral score,
//   * is cached briefly, because a page of 10 matches asks about the same
//     city and the same handful of crops.

const ML_BASE = process.env.ML_BASE || "http://localhost:8000";
const TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS || 2500);
const CACHE_TTL_MS = 60_000;

const cache = new Map(); // key -> { at, value }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  // Keep the map from growing without bound in a long-lived process.
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
}

async function postJson(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ML_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // offline, timed out, bad JSON - all the same to the caller
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Demand outlook for several crops in one city, in a single call.
 *
 * @returns {Promise<Map<string, {level:string, trendPct:number, predictedKg:number}>>}
 *          Empty map when the ML service is unavailable - callers then use a
 *          neutral demand score and say so in the explanation.
 */
async function demandInsights(location, crops) {
  const wanted = [...new Set((crops || []).filter(Boolean).map(String))];
  if (!location || wanted.length === 0) return new Map();

  const key = `insights:${String(location).toLowerCase()}:${wanted.sort().join(",")}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await postJson("/demand-insights", { location, crops: wanted });

  const map = new Map();
  if (data && Array.isArray(data.insights)) {
    for (const row of data.insights) {
      if (!row || !row.crop) continue;
      map.set(String(row.crop).toLowerCase(), {
        level: row.level || "Unknown",
        trendPct: Number(row.trend_pct) || 0,
        predictedKg: Number(row.predicted_demand_kg) || 0,
      });
    }
  }

  // Cache even an empty result: if the service is down, we should not retry it
  // once per request for the next minute.
  cacheSet(key, map);
  return map;
}

// Exposed so tests and callers can distinguish "ML said nothing about this
// crop" from "ML is offline".
async function isAvailable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ML_BASE + "/", { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function clearCache() {
  cache.clear();
}

module.exports = { demandInsights, isAvailable, clearCache, ML_BASE };
