/**
 * Delivery-partner assignment + fair-deal pricing tests.
 *
 *   Layer 1  the fair-price arithmetic, in-process
 *   Layer 2  the live API: assignment on acceptance, partner details,
 *            privacy, and the pricing endpoints
 *
 * Usage:  node server.js            (in one terminal)
 *         node smoke-test-value.js  (in another)
 */
require("dotenv").config();
const mongoose = require("mongoose");

const BASE = process.env.SMOKE_BASE || "http://localhost:5000/api";
const stamp = Date.now();

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

const register = (role, name, location, phone) =>
  call("POST", "/auth/register", {
    body: {
      name,
      email: `${name.toLowerCase().replace(/\W+/g, "")}.${stamp}@valuetest.local`,
      password: "test1234",
      role,
      location,
      phone,
    },
  });

// ===========================================================================
// Layer 1 - the fair-deal arithmetic
// ===========================================================================
function layer1() {
  console.log("\nLayer 1: fair-deal pricing\n");

  const {
    computeFairDeal,
    qualityNote,
    FARM_GATE_SHARE,
    RETAIL_MULTIPLE,
  } = require("./utils/fairPrice");

  const deal = computeFairDeal({
    referencePricePerKg: 30,
    pricePerKg: 32,
    quantityKg: 100,
  });

  check("farm gate sits below the market reference", deal.farmGatePrice < deal.reference, [
    deal.farmGatePrice,
    deal.reference,
  ]);
  check("retail sits above the market reference", deal.retailPrice > deal.reference, [
    deal.retailPrice,
    deal.reference,
  ]);
  check(
    "the recoverable gap is retail minus farm gate",
    Math.abs(deal.recoverableGapPerKg - (deal.retailPrice - deal.farmGatePrice)) < 0.01
  );
  check(
    "multipliers match the documented assumptions",
    Math.abs(deal.farmGatePrice - 30 * FARM_GATE_SHARE) < 0.01 &&
      Math.abs(deal.retailPrice - 30 * RETAIL_MULTIPLE) < 0.01
  );

  // The central claim: at a fair price BOTH sides are better off.
  check("at a fair price the farmer earns more than the farm gate", deal.farmerGainPerKg > 0);
  check("at a fair price the buyer pays less than retail", deal.buyerSavingPerKg > 0);
  check("both-win is reported", deal.bothWin === true);
  check("the verdict is 'fair'", deal.verdict.code === "fair", deal.verdict);

  // The two gains must exactly exhaust the gap - no value invented anywhere.
  check(
    "farmer gain + buyer saving equals the whole gap",
    Math.abs(deal.farmerGainPerKg + deal.buyerSavingPerKg - deal.recoverableGapPerKg) < 0.01,
    [deal.farmerGainPerKg, deal.buyerSavingPerKg, deal.recoverableGapPerKg]
  );

  check(
    "totals scale with quantity",
    Math.abs(deal.farmerGainTotal - deal.farmerGainPerKg * 100) < 0.01 &&
      Math.abs(deal.buyerSavingTotal - deal.buyerSavingPerKg * 100) < 0.01
  );

  // The balanced suggestion should please both sides.
  const suggested = computeFairDeal({
    referencePricePerKg: 30,
    pricePerKg: deal.suggestedPrice,
  });
  check(
    "the suggested price leaves both sides better off",
    suggested.farmerGainPerKg > 0 && suggested.buyerSavingPerKg > 0,
    [suggested.farmerGainPerKg, suggested.buyerSavingPerKg]
  );
  check(
    "an even split gives both sides a similar share",
    Math.abs(suggested.farmerGainPerKg - suggested.buyerSavingPerKg) < 0.02,
    [suggested.farmerGainPerKg, suggested.buyerSavingPerKg]
  );

  // Maximum farmer take must still leave the buyer something real.
  const maxed = computeFairDeal({
    referencePricePerKg: 30,
    pricePerKg: deal.maxFarmerPrice,
  });
  check(
    "the max-farmer price still leaves the buyer a saving",
    maxed.buyerSavingPerKg > 0,
    maxed.buyerSavingPerKg
  );
  check(
    "the max-farmer price beats the balanced one for the farmer",
    maxed.farmerGainPerKg > suggested.farmerGainPerKg
  );
  check("the max-farmer price stays under retail", deal.maxFarmerPrice < deal.retailPrice);

  // Bad prices are called out rather than dressed up as a deal.
  const tooLow = computeFairDeal({ referencePricePerKg: 30, pricePerKg: 15 });
  check("underpricing is flagged to the farmer", tooLow.verdict.code === "underpriced", tooLow.verdict);
  check("underpricing means a negative farmer gain", tooLow.farmerGainPerKg < 0);
  check("underpricing is not reported as a win", tooLow.bothWin === false);

  const tooHigh = computeFairDeal({ referencePricePerKg: 30, pricePerKg: 60 });
  check("over-retail pricing is flagged", tooHigh.verdict.code === "above-retail", tooHigh.verdict);
  check("over-retail means the buyer saves nothing", tooHigh.buyerSavingPerKg < 0);
  check("over-retail is not reported as a win", tooHigh.bothWin === false);

  // Monotonic: a higher price always helps the farmer and costs the buyer.
  const sweep = [22, 26, 30, 34, 38].map((p) =>
    computeFairDeal({ referencePricePerKg: 30, pricePerKg: p })
  );
  check(
    "farmer gain rises with price",
    sweep.every((d, i) => i === 0 || d.farmerGainPerKg > sweep[i - 1].farmerGainPerKg)
  );
  check(
    "buyer saving falls as price rises",
    sweep.every((d, i) => i === 0 || d.buyerSavingPerKg < sweep[i - 1].buyerSavingPerKg)
  );

  // Garbage in, nothing out - never a fabricated baseline.
  check("no reference means no deal", computeFairDeal({ referencePricePerKg: 0 }) === null);
  check("a missing reference means no deal", computeFairDeal({}) === null);

  // Quality must never be presented as the source of the saving.
  const notes = qualityNote(120).join(" ").toLowerCase();
  check("the quality note says the saving is not a grade cut", notes.includes("not from a lower grade"));
  check("the quality note mentions transit when distance is known", notes.includes("transit"));
  check("a quality note is still produced without a distance", qualityNote(null).length >= 2);

  // The assumptions travel with the numbers.
  check(
    "the response carries its assumptions",
    deal.assumptions &&
      deal.assumptions.farmGateShare === FARM_GATE_SHARE &&
      /estimates/i.test(deal.assumptions.note),
    deal.assumptions
  );
}

// ===========================================================================
// Layer 2 - live API
// ===========================================================================
async function layer2() {
  console.log("\nLayer 2: live assignment and pricing API\n");

  const farmerRes = await register("farmer", "ValFarmer", "Sonipat");
  const buyerRes = await register("buyer", "ValBuyer", "Gurgaon");
  const nearDriverRes = await register("driver", "NearDriver", "Sonipat", "9990001111");
  const farDriverRes = await register("driver", "FarDriver", "Chennai", "9990002222");

  const farmer = farmerRes.data.token;
  const buyer = buyerRes.data.token;

  check("test accounts created", !!(farmer && buyer && nearDriverRes.data.token));

  // Three listings so the crop has a real median to reference.
  const prices = [28, 30, 32];
  const productIds = [];
  for (const price of prices) {
    const res = await call("POST", "/products", {
      token: farmer,
      body: {
        cropName: `Valcrop${stamp}`,
        quantity: 500,
        location: "Sonipat",
        pricePerKg: price,
      },
    });
    productIds.push(res.data.product?._id);
  }
  check("three listings created for a price reference", productIds.every(Boolean));

  // ---- market reference ---------------------------------------------------
  const ref = await call(
    "GET",
    `/pricing/reference?crop=Valcrop${stamp}&location=Sonipat`,
    { token: buyer }
  );
  check("market reference is returned", ref.status === 200, ref.data);
  check(
    "the reference is the median of real listings",
    ref.data?.reference?.pricePerKg === 30,
    ref.data?.reference
  );
  check("the reference reports its sample size", ref.data?.reference?.sampleSize === 3);
  check(
    "the reference names what it was built from",
    typeof ref.data?.reference?.basis === "string",
    ref.data?.reference?.basis
  );

  const unknownRef = await call("GET", "/pricing/reference?crop=Unobtanium", { token: buyer });
  check("an unknown crop returns 404, not an invented price", unknownRef.status === 404, unknownRef.data);

  const noCrop = await call("GET", "/pricing/reference", { token: buyer });
  check("a missing crop is rejected (400)", noCrop.status === 400);

  const anonRef = await call("GET", `/pricing/reference?crop=Valcrop${stamp}`);
  check("pricing requires a login (401)", anonRef.status === 401);

  // ---- fair deal ----------------------------------------------------------
  const fair = await call("POST", "/pricing/fair-deal", {
    token: buyer,
    body: {
      cropName: `Valcrop${stamp}`,
      pricePerKg: 32,
      quantityKg: 100,
      location: "Sonipat",
      buyerLocation: "Gurgaon",
    },
  });
  check("fair-deal is returned", fair.status === 200, fair.data);

  const deal = fair.data?.deal;
  check("the farmer earns more than a farm-gate sale", deal?.farmerGainPerKg > 0, deal?.farmerGainPerKg);
  check("the buyer pays less than retail", deal?.buyerSavingPerKg > 0, deal?.buyerSavingPerKg);
  check("both sides win at this price", deal?.bothWin === true);
  check(
    "the two gains exhaust the recoverable gap",
    Math.abs(deal.farmerGainPerKg + deal.buyerSavingPerKg - deal.recoverableGapPerKg) < 0.01
  );
  check("a quality note is included", Array.isArray(fair.data?.quality) && fair.data.quality.length > 0);
  check(
    "quality is never given as the source of the saving",
    fair.data.quality.join(" ").toLowerCase().includes("not from a lower grade")
  );
  check(
    "farm-to-door distance is computed from real coordinates",
    fair.data?.transitKm > 0,
    fair.data?.transitKm
  );
  check(
    "the modelled figures are labelled as estimates",
    /estimates|not surveyed/i.test(deal.assumptions.note)
  );

  const noHistory = await call("POST", "/pricing/fair-deal", {
    token: buyer,
    body: { cropName: "Unobtanium", pricePerKg: 50 },
  });
  check(
    "a crop with no history gets no fabricated comparison (404)",
    noHistory.status === 404 && noHistory.data?.deal === null,
    noHistory.data
  );

  const badPrice = await call("POST", "/pricing/fair-deal", {
    token: buyer,
    body: { cropName: `Valcrop${stamp}`, pricePerKg: -5 },
  });
  check("a negative price is rejected (400)", badPrice.status === 400, badPrice.data);

  // ---- driver assignment on acceptance ------------------------------------
  const orderRes = await call("POST", "/orders", {
    token: buyer,
    body: {
      items: [{ productId: productIds[0], quantity: 10 }],
      deliveryAddress: "Sector 45, Gurgaon",
    },
  });
  const orderId = orderRes.data.order?._id;
  check("buyer places an order", orderRes.status === 201, orderRes.data);

  const beforeAccept = await call("GET", "/orders", { token: buyer });
  const pending = (beforeAccept.data || []).find((o) => o._id === orderId);
  check("no partner is assigned while the order is pending", !pending?.driver, pending?.driver);

  await call("PATCH", `/orders/${orderId}/status`, { token: farmer, body: { status: "Accepted" } });

  const afterAccept = await call("GET", "/orders", { token: buyer });
  const accepted = (afterAccept.data || []).find((o) => o._id === orderId);

  check("a delivery partner is assigned on acceptance", !!accepted?.driver, accepted?.driver);
  check("the partner has a name", !!accepted?.driver?.name);
  check("the partner has a contact number", accepted?.driver?.phone === "9990001111" || accepted?.driver?.phone === "9990002222", accepted?.driver?.phone);
  check("the partner has a city", typeof accepted?.driver?.location === "string");
  check(
    "the partner carries a completed-delivery count",
    typeof accepted?.driver?.completedDeliveries === "number",
    accepted?.driver?.completedDeliveries
  );

  // Nearest driver should win over one in another state.
  check(
    "the nearer driver is preferred over the distant one",
    accepted?.driver?.name === "NearDriver",
    accepted?.driver?.name
  );


  // ---- privacy ------------------------------------------------------------
  const serialised = JSON.stringify(accepted?.driver || {});
  check("the partner card exposes no email", !serialised.includes("@valuetest.local"), serialised);
  check("the partner card exposes no password", !serialised.includes("password"));
  check(
    "the partner card carries only delivery-relevant fields",
    Object.keys(accepted?.driver || {}).sort().join(",") ===
      "completedDeliveries,id,location,name,partnerSince,phone",
    Object.keys(accepted?.driver || {})
  );

  // ---- the partner also shows on the tracking view ------------------------
  const tracking = await call("GET", `/orders/${orderId}/tracking`, { token: buyer });
  check("tracking carries the delivery partner", !!tracking.data?.deliveryPartner, tracking.data?.deliveryPartner);
  check(
    "tracking's partner matches the order's",
    tracking.data?.deliveryPartner?.name === accepted?.driver?.name
  );
  check(
    "tracking's partner exposes no email",
    !JSON.stringify(tracking.data.deliveryPartner).includes("@valuetest.local")
  );

  // ---- reality wins: whoever collects it owns it --------------------------
  const farDriver = farDriverRes.data.token;
  await call("PATCH", `/orders/${orderId}/status`, { token: farDriver, body: { status: "In Transit" } });

  const afterPickup = await call("GET", "/orders", { token: buyer });
  const moving = (afterPickup.data || []).find((o) => o._id === orderId);
  check(
    "the partner re-points to whoever actually collected the order",
    moving?.driver?.name === "FarDriver",
    moving?.driver?.name
  );
  check("the buyer still has a contact number after the change", !!moving?.driver?.phone);
}

// ===========================================================================
(async () => {
  console.log(`\nFarmLink delivery-partner + fair-deal tests  (${BASE})`);

  layer1();

  const reachable = await fetch(BASE.replace(/\/api$/, "/"))
    .then((r) => r.ok)
    .catch(() => false);

  if (!reachable) {
    console.log("\n  SKIP  backend not running - Layer 2 skipped\n");
  } else {
    await layer2();

    await mongoose.connect(process.env.MONGO_URI);
    const User = require("./models/User");
    const Product = require("./models/Product");
    const Order = require("./models/Order");
    const Conversation = require("./models/Conversation");

    const users = await User.find({ email: new RegExp(`${stamp}@valuetest.local`) });
    const ids = users.map((u) => u._id);
    await Conversation.deleteMany({ participants: { $in: ids } });
    await Order.deleteMany({ buyerId: { $in: ids } });
    await Product.deleteMany({ farmerId: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();

    console.log(`\ncleaned up ${users.length} test users and their data`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error("\nVALUE TEST CRASHED:", e);
  process.exit(1);
});
