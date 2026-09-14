const test = require("node:test");
const assert = require("node:assert/strict");
const { computeCharges, chargesBalance, rateCardFee, toPaise } = require("../utils/fees");

test("rate card: base + distance + weight, never below the minimum", () => {
  const card = { baseFee: 30, perKm: 6, perKg: 0.3, minFee: 40 };
  assert.equal(rateCardFee(card, 10, 20), 96); // 30 + 60 + 6
  assert.equal(rateCardFee(card, 0, 1), 40); // 30.3 -> minimum
  assert.equal(rateCardFee(card, 12.34, 7), 106); // 30 + 74.04 + 2.1 = 106.14 -> 106
  assert.equal(rateCardFee(card, -5, -5), 40, "negative inputs cannot discount a trip");
});

test("charges: buyer pays goods + carrier rate + markup; farmer pays commission", () => {
  const charges = computeCharges({
    lines: [{ farmerId: "f1", totalPrice: 1000 }],
    providerFee: 100,
    commissionPct: 4,
    logisticsMarkupPct: 8,
  });

  assert.equal(charges.goods, 1000);
  assert.equal(charges.deliveryFee, 108);
  assert.equal(charges.grandTotal, 1108);
  assert.equal(charges.commission, 40);
  assert.equal(charges.farmerPayout, 960);
  assert.equal(charges.logisticsPayout, 100);
  assert.equal(charges.platformRevenue, 48);
  assert.ok(chargesBalance(charges));
});

test("charges: every split closes to the paisa, across awkward numbers", () => {
  // Deterministic pseudo-random so a failure is reproducible.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };

  for (let i = 0; i < 2000; i += 1) {
    const lineCount = 1 + Math.floor(rand() * 5);
    const lines = Array.from({ length: lineCount }, (_, n) => ({
      farmerId: `f${Math.floor(rand() * 3)}`,
      totalPrice: Math.round(rand() * 500000) / 100 + n / 3, // deliberately non-terminating
    }));
    const charges = computeCharges({
      lines,
      providerFee: Math.round(rand() * 90000) / 100,
      commissionPct: Math.round(rand() * 1500) / 100,
      logisticsMarkupPct: Math.round(rand() * 2000) / 100,
    });

    assert.ok(chargesBalance(charges), `split does not balance on iteration ${i}`);
    const perFarmer = charges.farmers.reduce((s, f) => s + f.payoutPaise, 0);
    assert.equal(perFarmer, charges.paise.farmerPayout, "per-farmer payouts sum to the farmer total");
    for (const value of Object.values(charges.paise)) {
      assert.ok(Number.isInteger(value), "ledger amounts are whole paise");
    }
  }
});

test("charges: multi-farmer orders split commission per farmer", () => {
  const charges = computeCharges({
    lines: [
      { farmerId: "a", totalPrice: 300 },
      { farmerId: "b", totalPrice: 200 },
      { farmerId: "a", totalPrice: 100 },
    ],
    providerFee: 0,
    commissionPct: 2.5,
  });
  const a = charges.farmers.find((f) => f.farmerId === "a");
  const b = charges.farmers.find((f) => f.farmerId === "b");
  assert.equal(a.goods, 400);
  assert.equal(a.payout, 390);
  assert.equal(b.payout, 195);
  assert.equal(charges.deliveryFee, 0);
});

test("toPaise rounds half-paise instead of truncating", () => {
  assert.equal(toPaise(19.995), 2000);
  assert.equal(toPaise("12.3"), 1230);
  assert.equal(toPaise(undefined), 0);
});
