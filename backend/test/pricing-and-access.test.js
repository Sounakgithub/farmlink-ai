const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.ROUTING_PROVIDER = "haversine";

const Product = require("../models/Product");
const ApiKey = require("../models/ApiKey");
const { allowRequest, resetRateLimits } = require("../middleware/apiKey");
const { roadRoute, pointFrom, clearRoutingCache } = require("../utils/roadRouting");
const { covers } = require("../utils/logistics");
const { scoreReliability, WEIGHTS } = require("../utils/matching/score");

const farmerId = new mongoose.Types.ObjectId();
const listing = (extra = {}) =>
  new Product({
    farmerId,
    farmerName: "Test Farmer",
    cropName: "Tomato",
    quantity: 1000,
    location: "Delhi",
    pricePerKg: 30,
    ...extra,
  });

test("bulk tiers: the deepest qualifying tier wins", () => {
  const p = listing({
    bulkTiers: [
      { minQuantityKg: 100, pricePerKg: 27 },
      { minQuantityKg: 300, pricePerKg: 25 },
    ],
  });
  assert.equal(p.validateSync(), undefined);
  assert.equal(p.priceFor(50), 30);
  assert.equal(p.priceFor(100), 27);
  assert.equal(p.priceFor(299), 27);
  assert.equal(p.priceFor(400), 25);
});

test("bulk tiers: a tier that does not get cheaper is rejected", () => {
  const p = listing({
    bulkTiers: [
      { minQuantityKg: 100, pricePerKg: 25 },
      { minQuantityKg: 300, pricePerKg: 26 },
    ],
  });
  assert.ok(p.validateSync()?.errors?.bulkTiers);
});

test("bulk tiers: a stale tier above the base price is ignored at checkout", () => {
  const p = listing({ pricePerKg: 20, bulkTiers: [{ minQuantityKg: 100, pricePerKg: 22 }] });
  assert.equal(p.priceFor(500), 20);
});

test("api keys: hashed at rest and verified in constant time", () => {
  const plaintext = "fl_live_0a1b2c3d_" + "f".repeat(48);
  const key = new ApiKey({
    ownerId: farmerId,
    name: "ERP",
    prefix: "fl_live_0a1b2c3d",
    keyHash: ApiKey.hashKey(plaintext),
  });
  assert.ok(!key.keyHash.includes("ffff"), "the secret is not stored");
  assert.ok(key.matches(plaintext));
  assert.ok(!key.matches(plaintext.slice(0, -1) + "e"));
  assert.ok(!("keyHash" in key.toSafeJSON()));
});

test("api keys: unknown scopes are refused", () => {
  const key = new ApiKey({ ownerId: farmerId, name: "x", prefix: "p", keyHash: "h", scopes: ["orders:delete"] });
  assert.ok(key.validateSync()?.errors?.scopes);
});

test("rate limit: sliding window per key", () => {
  resetRateLimits();
  for (let i = 0; i < 3; i += 1) assert.ok(allowRequest("k1", 3).allowed);
  const blocked = allowRequest("k1", 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
  assert.ok(allowRequest("k2", 3).allowed, "keys do not share a window");
  resetRateLimits();
});

test("routing: never invents a location, and flags straight-line estimates", async () => {
  clearRoutingCache();
  assert.equal(pointFrom("Atlantis"), null);
  assert.equal(await roadRoute("Atlantis", "Delhi"), null);

  const route = await roadRoute("Delhi", "Gurgaon");
  assert.equal(route.source, "haversine");
  assert.equal(route.approximate, true);
  assert.ok(route.distanceKm > 15 && route.distanceKm < 40, `Delhi-Gurgaon was ${route.distanceKm} km`);
  assert.ok(route.durationMin > 0);
  assert.ok(route.geometry.length >= 2);
});

test("carrier coverage matches cities inside full addresses", () => {
  const provider = { coverageCities: ["Gurgaon", "Delhi"] };
  assert.ok(covers(provider, "Sector 45, Gurgaon"));
  assert.ok(covers(provider, "delhi"));
  assert.ok(!covers(provider, "Mumbai"));
  assert.ok(!covers(provider, ""));
});

test("matching: inspection quality moves farmer reliability without breaking the scale", () => {
  const record = { orderCount: 6, completed: 5, broken: 0, live: 1 };
  const clean = scoreReliability({ ...record, quality: { inspected: 5, passed: 5 } });
  const poor = scoreReliability({ ...record, quality: { inspected: 5, passed: 1 } });
  const uninspected = scoreReliability(record);

  assert.equal(clean.score, WEIGHTS.reliability, "a perfect record is still a perfect score");
  assert.equal(uninspected.score, WEIGHTS.reliability, "no inspections leaves the old behaviour");
  assert.ok(poor.score < clean.score);
  assert.equal(poor.qualityPassPct, 20);
});
