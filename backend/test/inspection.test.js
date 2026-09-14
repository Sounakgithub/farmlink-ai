const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluatePickup,
  evaluateDelivery,
  determineLiability,
  canInspectPickup,
} = require("../utils/inspection");

const goodChecks = { freshness: true, pestFree: true, packaging: true, moistureOk: true };

test("pickup: a clean grade A load passes", () => {
  const v = evaluatePickup({ grade: "a", checks: goodChecks, expectedKg: 100, measuredKg: 99 });
  assert.equal(v.result, "passed");
  assert.equal(v.grade, "A");
  assert.deepEqual(v.problems, []);
});

test("pickup: packaging and moisture are advisories, not failures", () => {
  const v = evaluatePickup({ grade: "B", checks: { ...goodChecks, packaging: false, moistureOk: false } });
  assert.equal(v.result, "passed");
  assert.equal(v.reasons.length, 2);
});

test("pickup: freshness, pests and short weight each fail the load", () => {
  for (const input of [
    { checks: { ...goodChecks, freshness: false } },
    { checks: { ...goodChecks, pestFree: false } },
    { checks: goodChecks, expectedKg: 100, measuredKg: 90 },
  ]) {
    const v = evaluatePickup({ grade: "B", notes: "Checked at the farm gate", ...input });
    assert.equal(v.result, "failed", JSON.stringify(input));
    assert.deepEqual(v.problems, []);
  }
});

test("pickup: weight inside the tolerance passes", () => {
  const v = evaluatePickup({ grade: "A", checks: goodChecks, expectedKg: 100, measuredKg: 95.5 });
  assert.equal(v.result, "passed");
});

test("pickup: a failure must be explained, and REJECT needs a photo", () => {
  const unexplained = evaluatePickup({ grade: "B", checks: { freshness: false } });
  assert.ok(unexplained.problems.some((p) => /notes/i.test(p)));

  const noPhoto = evaluatePickup({ grade: "REJECT", notes: "Rotting at the core" });
  assert.ok(noPhoto.problems.some((p) => /photo/i.test(p)));

  const evidenced = evaluatePickup({
    grade: "REJECT",
    notes: "Rotting at the core",
    photos: ["https://example.com/crate.jpg", "javascript:alert(1)"],
  });
  assert.deepEqual(evidenced.problems, []);
  assert.deepEqual(evidenced.photos, ["https://example.com/crate.jpg"], "non-http photo links are dropped");
});

test("pickup: an unknown grade is an input problem", () => {
  assert.ok(evaluatePickup({ grade: "S" }).problems.length > 0);
});

test("delivery: good condition passes; damage opens a dispute that needs notes", () => {
  assert.equal(evaluateDelivery({ condition: "good" }, { expectedKg: 50 }).result, "passed");

  const damaged = evaluateDelivery({ condition: "damaged" }, { expectedKg: 50 });
  assert.equal(damaged.result, "disputed");
  assert.ok(damaged.problems.length > 0);

  const light = evaluateDelivery({ condition: "good", receivedKg: 40, notes: "Weighed on arrival" }, { expectedKg: 50 });
  assert.equal(light.result, "disputed", "a 'good' label cannot hide missing weight");
});

test("liability follows the chain of custody", () => {
  const passedA = { result: "passed", grade: "A", measuredKg: 100, expectedKg: 100 };
  const passedC = { result: "passed", grade: "C", measuredKg: 100, expectedKg: 100 };

  assert.equal(determineLiability(passedA, { result: "passed" }).liability, "none");
  assert.equal(determineLiability(null, { result: "disputed", condition: "damaged" }).liability, "undetermined");
  assert.equal(
    determineLiability({ result: "failed", grade: "REJECT" }, { result: "disputed", condition: "spoiled" }).liability,
    "farmer"
  );
  assert.equal(determineLiability(passedA, { result: "disputed", condition: "damaged" }).liability, "logistics");
  assert.equal(determineLiability(passedC, { result: "disputed", condition: "spoiled" }).liability, "shared");
  assert.equal(
    determineLiability(passedA, { result: "disputed", condition: "good", measuredKg: 80 }).liability,
    "logistics",
    "weight weighed onto the truck but missing at the door is the carrier's"
  );
  assert.equal(
    determineLiability(passedA, { result: "disputed", condition: "short", measuredKg: 98 }).liability,
    "undetermined",
    "a short claim inside tolerance needs review"
  );
});

test("pickup inspection rights", () => {
  const driver = { _id: "d1", role: "driver" };
  const companyDriver = { _id: "d2", role: "driver", providerId: "p1" };
  const buyer = { _id: "b1", role: "buyer" };

  const pooled = { logistics: { mode: "independent" }, driverId: null };
  const carried = { logistics: { mode: "provider", providerId: "p1" }, driverId: "d9" };

  assert.ok(canInspectPickup(pooled, driver));
  assert.ok(!canInspectPickup(pooled, buyer));
  assert.ok(canInspectPickup(carried, companyDriver), "any driver of the assigned carrier");
  assert.ok(!canInspectPickup(carried, driver), "not a driver from outside the carrier");
  assert.ok(canInspectPickup(carried, { role: "admin" }));
});
