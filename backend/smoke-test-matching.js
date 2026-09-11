/**
 * AI farmer <-> buyer matching tests.
 *
 * Two layers:
 *   Layer 1  the pure scoring engine, in-process, no server or database
 *   Layer 2  the live HTTP API, with real users, products and orders
 *
 * Covers: score ranges, breakdown arithmetic, ranking order, gradual (not
 * binary) scoring, authorization, ownership, privacy, new users, missing
 * location, out-of-stock, invalid input and the ML-offline fallback.
 *
 * Usage:  node server.js               (in one terminal)
 *         node smoke-test-matching.js  (in another)
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

const register = (role, name, extra = {}) =>
  call("POST", "/auth/register", {
    body: {
      name,
      email: `${name.toLowerCase().replace(/\W+/g, "")}.${stamp}@matchtest.local`,
      password: "test1234",
      role,
      location: "Delhi",
      ...extra,
    },
  });

const sumBreakdown = (breakdown) =>
  Object.values(breakdown).reduce((total, part) => total + part.score, 0);

// ===========================================================================
// Layer 1 - the scoring engine on its own
// ===========================================================================
function layer1() {
  console.log("\nLayer 1: scoring engine (no server needed)\n");

  const score = require("./utils/matching/score");
  const { explain } = require("./utils/matching/explain");
  const { rankMatches } = require("./utils/matching");

  const richProfile = {
    totalLines: 10,
    cropCounts: new Map([["tomato", 6], ["onion", 4]]),
    typicalQuantityKg: 300,
    typicalPricePerKg: 32,
    orderCount: 8,
    completed: 7,
    broken: 0,
    live: 1,
    isNewcomer: false,
  };

  // ---- a brand new user is neutral, never zero ---------------------------
  const newcomer = score.scoreMatch({
    cropName: "Tomato",
    pricePerKg: 30,
    availableKg: 500,
    productLocation: "Atlantis",
    counterpartyLocation: "El Dorado",
    prefs: {},
    profile: null,
    demand: null,
  });
  check("new user with no data scores a neutral 60, not 0", newcomer.matchScore === 60, newcomer.matchScore);
  check("new user is described as 'Good', not 'Weak'", newcomer.matchQuality === "Good", newcomer.matchQuality);
  check(
    "every pillar of a no-data score is above zero",
    Object.values(newcomer.scoreBreakdown).every((p) => p.score > 0),
    newcomer.scoreBreakdown
  );

  // ---- a perfect pairing maxes out ---------------------------------------
  const perfect = score.scoreMatch({
    cropName: "Tomato",
    pricePerKg: 28,
    availableKg: 500,
    productLocation: "Delhi",
    counterpartyLocation: "Delhi",
    prefs: { preferredCrops: ["Tomato"], maxPricePerKg: 35, preferredQuantityKg: 300 },
    profile: richProfile,
    reliabilityProfile: richProfile,
    demand: { level: "High", trendPct: 12 },
  });
  check("an ideal pairing reaches 100 / Excellent", perfect.matchScore === 100 && perfect.matchQuality === "Excellent", perfect.matchScore);

  // ---- breakdown arithmetic ----------------------------------------------
  const cases = [newcomer, perfect];
  for (let i = 0; i < 40; i++) {
    cases.push(
      score.scoreMatch({
        cropName: ["Tomato", "Onion", "Rice", "Mango"][i % 4],
        pricePerKg: 5 + i * 3,
        availableKg: i * 37,
        productLocation: ["Delhi", "Mumbai", "Nowhere", ""][i % 4],
        counterpartyLocation: ["Patna", "Delhi", "", "Chennai"][i % 4],
        prefs: i % 3 === 0 ? { preferredCrops: ["Onion"], maxPricePerKg: 40 } : {},
        profile: i % 2 === 0 ? richProfile : null,
        reliabilityProfile: i % 2 === 0 ? richProfile : null,
        demand: i % 5 === 0 ? { level: "Low", trendPct: -30 } : null,
      })
    );
  }

  check(
    "breakdown always sums exactly to matchScore (42 cases)",
    cases.every((c) => Math.abs(sumBreakdown(c.scoreBreakdown) - c.matchScore) < 1e-9),
    cases.map((c) => [sumBreakdown(c.scoreBreakdown), c.matchScore]).slice(0, 4)
  );
  check(
    "every score stays inside 0-100",
    cases.every((c) => c.matchScore >= 0 && c.matchScore <= 100)
  );
  check(
    "no pillar ever exceeds its weight",
    cases.every((c) =>
      Object.values(c.scoreBreakdown).every((p) => p.score >= 0 && p.score <= p.max)
    )
  );
  check(
    "pillar weights total 100",
    Object.values(score.WEIGHTS).reduce((a, b) => a + b, 0) === 100
  );

  // ---- gradual, not binary ------------------------------------------------
  const quantitySweep = [50, 150, 300, 600].map(
    (kg) => score.scoreQuantity(kg, {}, richProfile).score
  );
  check(
    "quantity scores rise gradually with stock, not as yes/no",
    quantitySweep[0] < quantitySweep[1] &&
      quantitySweep[1] < quantitySweep[2] &&
      quantitySweep[2] <= quantitySweep[3] &&
      new Set(quantitySweep).size >= 3,
    quantitySweep
  );

  const distanceSweep = ["Delhi", "Jaipur", "Mumbai", "Chennai"].map(
    (city) => score.scoreDistance("Delhi", city, {}).score
  );
  check(
    "distance decays gradually with real km",
    distanceSweep[0] > distanceSweep[1] &&
      distanceSweep[1] > distanceSweep[2] &&
      distanceSweep[2] > distanceSweep[3],
    distanceSweep
  );

  const priceSweep = [20, 34, 40, 50].map(
    (p) => score.scorePrice(p, {}, richProfile).score
  );
  check(
    "price fit falls off gradually above the usual price",
    priceSweep[0] >= priceSweep[1] && priceSweep[1] > priceSweep[2] && priceSweep[2] > priceSweep[3],
    priceSweep
  );

  // ---- missing / unknown inputs are handled, not crashed on --------------
  check(
    "unknown location falls back to neutral, no fake coordinates",
    score.scoreDistance("Narnia", "Gondor", {}).basis === "unknown-location"
  );
  check(
    "a known city pair uses real haversine distance",
    score.scoreDistance("Delhi", "Mumbai", {}).basis === "coordinates"
  );
  check(
    "out-of-stock zeroes only the quantity pillar",
    score.scoreQuantity(0, {}, richProfile).score === 0 &&
      score.scoreMatch({
        cropName: "Tomato",
        pricePerKg: 30,
        availableKg: 0,
        productLocation: "Delhi",
        counterpartyLocation: "Delhi",
        prefs: {},
        profile: richProfile,
        reliabilityProfile: richProfile,
        demand: null,
      }).matchScore > 0
  );
  check(
    "ML offline gives the documented neutral demand score",
    score.scoreDemand(null).score === 6 && score.scoreDemand(null).basis === "forecast-unavailable"
  );
  check(
    "a high demand forecast beats a low one",
    score.scoreDemand({ level: "High", trendPct: 0 }).score >
      score.scoreDemand({ level: "Low", trendPct: 0 }).score
  );

  // ---- explanations -------------------------------------------------------
  const explained = explain(perfect, { cropName: "Tomato", direction: "buyers", productLocation: "Delhi" });
  check("a strong match produces positive reasons", explained.reasons.length >= 3, explained.reasons);
  const explainedGap = explain(newcomer, { cropName: "Tomato", direction: "buyers" });
  check(
    "a no-data match reports its limitations honestly",
    explainedGap.limitations.length >= 3,
    explainedGap.limitations
  );
  check(
    "ML-offline is called out in the limitations",
    explainedGap.limitations.some((l) => l.toLowerCase().includes("demand"))
  );

  // ---- ranking ------------------------------------------------------------
  const ranked = rankMatches([
    { id: "a", matchScore: 55, scoreBreakdown: { crop: { score: 10 } } },
    { id: "b", matchScore: 91, scoreBreakdown: { crop: { score: 25 } } },
    { id: "c", matchScore: 73, scoreBreakdown: { crop: { score: 17 } } },
  ]);
  check(
    "ranking puts the highest score first",
    ranked.map((r) => r.id).join("") === "bca",
    ranked.map((r) => r.id)
  );

  // ---- quality tiers ------------------------------------------------------
  check(
    "quality tiers match the documented thresholds",
    score.qualityFor(95) === "Excellent" &&
      score.qualityFor(80) === "Strong" &&
      score.qualityFor(65) === "Good" &&
      score.qualityFor(45) === "Possible" &&
      score.qualityFor(20) === "Weak"
  );
}

// ===========================================================================
// Layer 2 - the live API
// ===========================================================================
async function layer2() {
  console.log("\nLayer 2: live matching API\n");

  const farmerRes = await register("farmer", "MatchFarmer");
  const farmer2Res = await register("farmer", "OtherFarmer");
  const buyerRes = await register("buyer", "MatchBuyer");
  const newBuyerRes = await register("buyer", "FreshBuyer");
  const driverRes = await register("driver", "MatchDriver");

  const farmer = farmerRes.data.token;
  const farmer2 = farmer2Res.data.token;
  const buyer = buyerRes.data.token;
  const newBuyer = newBuyerRes.data.token;
  const driver = driverRes.data.token;

  check("test accounts created", !!(farmer && buyer && driver && farmer2 && newBuyer));

  // ---- a listing to match against ----------------------------------------
  const productRes = await call("POST", "/products", {
    token: farmer,
    body: { cropName: "Tomato", quantity: 500, location: "Delhi", pricePerKg: 30 },
  });
  const productId = productRes.data.product?._id;
  check("farmer lists a crop", productRes.status === 201 && !!productId, productRes.data);

  // ---- buyer preferences via the existing profile endpoint ---------------
  const prefsRes = await call("PATCH", "/auth/me", {
    token: buyer,
    body: {
      buyerPreferences: {
        preferredCrops: ["Tomato"],
        maxPricePerKg: 40,
        preferredQuantityKg: 200,
        preferredLocations: ["Delhi"],
        purchaseFrequency: "weekly",
      },
    },
  });
  check("buyer saves preferences on PATCH /auth/me", prefsRes.status === 200, prefsRes.data);
  check(
    "preferences come back on the user object",
    prefsRes.data?.user?.buyerPreferences?.preferredCrops?.includes("Tomato"),
    prefsRes.data?.user?.buyerPreferences
  );
  check(
    "saving preferences never leaks the password",
    !JSON.stringify(prefsRes.data).includes("password")
  );

  const swapped = await call("PATCH", "/auth/me", {
    token: buyer,
    body: { buyerPreferences: { minPricePerKg: 90, maxPricePerKg: 20 } },
  });
  check(
    "a reversed price range is corrected, not stored backwards",
    swapped.data?.user?.buyerPreferences?.minPricePerKg === 20 &&
      swapped.data?.user?.buyerPreferences?.maxPricePerKg === 90,
    swapped.data?.user?.buyerPreferences
  );
  // put the sensible budget back for the scoring checks below
  await call("PATCH", "/auth/me", {
    token: buyer,
    body: { buyerPreferences: { minPricePerKg: null, maxPricePerKg: 40 } },
  });

  const farmerPrefs = await call("PATCH", "/auth/me", {
    token: farmer,
    body: { buyerPreferences: { preferredCrops: ["Onion"] } },
  });
  check("a farmer cannot set buyer preferences (403)", farmerPrefs.status === 403, farmerPrefs.data);

  // ---- farmer -> buyers ---------------------------------------------------
  const matches = await call("GET", `/matching/product/${productId}/buyers`, { token: farmer });
  check("farmer gets buyer matches for their own product", matches.status === 200, matches.data);

  const list = matches.data?.matches || [];
  check("matches are returned", list.length > 0, matches.data);
  check("at most 10 by default", list.length <= 10, list.length);

  if (list.length > 0) {
    check(
      "every match score is inside 0-100",
      list.every((m) => m.matchScore >= 0 && m.matchScore <= 100)
    );
    check(
      "every breakdown sums to its match score",
      list.every((m) => Math.abs(sumBreakdown(m.scoreBreakdown) - m.matchScore) < 0.001),
      list.map((m) => [sumBreakdown(m.scoreBreakdown), m.matchScore])
    );
    check(
      "results are sorted by score, highest first",
      list.every((m, i) => i === 0 || list[i - 1].matchScore >= m.matchScore),
      list.map((m) => m.matchScore)
    );
    check(
      "every match carries a quality tier",
      list.every((m) =>
        ["Excellent", "Strong", "Good", "Possible", "Weak"].includes(m.matchQuality)
      )
    );
    check(
      "every match carries all six pillars",
      list.every((m) =>
        ["crop", "distance", "price", "quantity", "demand", "reliability"].every(
          (k) => m.scoreBreakdown[k] !== undefined
        )
      )
    );
    check(
      "every match carries reasons or limitations",
      list.every((m) => Array.isArray(m.reasons) && Array.isArray(m.limitations))
    );

    // privacy
    const serialised = JSON.stringify(list);
    check("buyer emails are never exposed to the farmer", !serialised.includes("@matchtest.local"), );
    check("no password field is exposed", !serialised.includes("password"));
    check("no phone field is exposed", !/"phone"/.test(serialised));
    check("no delivery address is exposed", !/"deliveryAddress"/.test(serialised));
    check(
      "buyer cards carry only name, role and city",
      list.every((m) => {
        const keys = Object.keys(m.buyer).sort().join(",");
        return keys === "id,location,memberSince,name,role";
      }),
      Object.keys(list[0].buyer)
    );

    // the buyer who declared a Tomato preference should beat the blank one
    const prefBuyer = list.find((m) => m.buyer.name === "MatchBuyer");
    const blankBuyer = list.find((m) => m.buyer.name === "FreshBuyer");
    if (prefBuyer && blankBuyer) {
      check(
        "a buyer who wants this crop outranks one with no preferences",
        prefBuyer.matchScore > blankBuyer.matchScore,
        [prefBuyer.matchScore, blankBuyer.matchScore]
      );
      check(
        "the blank buyer still gets a fair score, not zero",
        blankBuyer.matchScore >= 40,
        blankBuyer.matchScore
      );
    } else {
      check("both test buyers appear in the matches", false, list.map((m) => m.buyer.name));
    }
  }

  // ---- authorization / ownership -----------------------------------------
  const otherFarmer = await call("GET", `/matching/product/${productId}/buyers`, { token: farmer2 });
  check("another farmer cannot match against this product (403)", otherFarmer.status === 403, otherFarmer.data);

  const buyerOnFarmerRoute = await call("GET", `/matching/product/${productId}/buyers`, { token: buyer });
  check("a buyer cannot use the farmer matching route (403)", buyerOnFarmerRoute.status === 403, buyerOnFarmerRoute.data);

  const anonymous = await call("GET", `/matching/product/${productId}/buyers`);
  check("no token is rejected (401)", anonymous.status === 401, anonymous.data);

  const badId = await call("GET", "/matching/product/not-an-id/buyers", { token: farmer });
  check("an invalid product id is rejected (400)", badId.status === 400, badId.data);

  const missing = await call("GET", `/matching/product/${"5".repeat(24)}/buyers`, { token: farmer });
  check("an unknown product id returns 404", missing.status === 404, missing.data);

  // ---- buyer -> products --------------------------------------------------
  const recs = await call("GET", "/matching/buyer/recommendations", { token: buyer });
  check("buyer gets recommendations", recs.status === 200, recs.data);

  const recList = recs.data?.matches || [];
  check("recommendations are returned", recList.length > 0, recs.data);
  check("at most 10 by default", recList.length <= 10, recList.length);

  if (recList.length > 0) {
    check(
      "every recommendation breakdown reconciles",
      recList.every((m) => Math.abs(sumBreakdown(m.scoreBreakdown) - m.matchScore) < 0.001)
    );
    check(
      "recommendations are sorted by score",
      recList.every((m, i) => i === 0 || recList[i - 1].matchScore >= m.matchScore),
      recList.map((m) => m.matchScore)
    );
    check(
      "only in-stock crops are recommended by default",
      recList.every((m) => m.product.quantity > 0)
    );
    check(
      "recommendations never leak a farmer's email",
      !JSON.stringify(recList).includes("@matchtest.local")
    );

    const tomato = recList.find((m) => m.product.cropName === "Tomato");
    check("the buyer's preferred crop is recommended", !!tomato, recList.map((m) => m.product.cropName));
    if (tomato) {
      check(
        "a stated crop preference scores full marks on crop fit",
        tomato.scoreBreakdown.crop.score === tomato.scoreBreakdown.crop.max,
        tomato.scoreBreakdown.crop
      );
    }
  }

  const limited = await call("GET", "/matching/buyer/recommendations?limit=2", { token: buyer });
  check("the limit parameter is honoured", (limited.data?.matches || []).length <= 2, limited.data?.matches?.length);

  const farmerOnBuyerRoute = await call("GET", "/matching/buyer/recommendations", { token: farmer });
  check("a farmer cannot use the buyer route (403)", farmerOnBuyerRoute.status === 403, farmerOnBuyerRoute.data);

  const driverOnBuyerRoute = await call("GET", "/matching/buyer/recommendations", { token: driver });
  check("a driver cannot use the buyer route (403)", driverOnBuyerRoute.status === 403, driverOnBuyerRoute.data);

  // ---- a buyer with no history or preferences still gets fair results -----
  const freshRecs = await call("GET", "/matching/buyer/recommendations", { token: newBuyer });
  check("a brand-new buyer still gets recommendations", freshRecs.status === 200 && (freshRecs.data?.matches || []).length > 0, freshRecs.data);
  check(
    "the API flags that a new buyer's results are not personalised",
    freshRecs.data?.personalisation?.hasHistory === false &&
      freshRecs.data?.personalisation?.hasPreferences === false,
    freshRecs.data?.personalisation
  );
  check(
    "a new buyer's scores are neutral, never zero",
    (freshRecs.data?.matches || []).every((m) => m.matchScore >= 30),
    (freshRecs.data?.matches || []).map((m) => m.matchScore)
  );

  // ---- ML availability is reported, whichever way it went ----------------
  check(
    "the API reports whether the demand forecast was available",
    typeof matches.data?.demandForecastAvailable === "boolean",
    matches.data?.demandForecastAvailable
  );
  console.log(
    `        (demand forecast ${matches.data?.demandForecastAvailable ? "WAS" : "was NOT"} reachable this run - both are valid)`
  );

  // ---- out of stock -------------------------------------------------------
  await call("PATCH", `/products/${productId}`, { token: farmer, body: { quantity: 0 } });
  const soldOut = await call("GET", `/matching/product/${productId}/buyers`, { token: farmer });
  check("a sold-out crop still returns matches", soldOut.status === 200 && (soldOut.data?.matches || []).length > 0, soldOut.data);
  check(
    "a sold-out crop scores zero on quantity but not overall",
    (soldOut.data?.matches || []).every(
      (m) => m.scoreBreakdown.quantity.score === 0 && m.matchScore > 0
    ),
    (soldOut.data?.matches || []).map((m) => m.scoreBreakdown.quantity.score)
  );
  const outOfStockRecs = await call("GET", "/matching/buyer/recommendations", { token: buyer });
  check(
    "a sold-out crop drops out of buyer recommendations",
    !(outOfStockRecs.data?.matches || []).some((m) => String(m.product._id) === String(productId))
  );
  await call("PATCH", `/products/${productId}`, { token: farmer, body: { quantity: 500 } });

  // ---- contact flows reuse the existing messaging system ------------------
  const farmerChat = await call("POST", "/conversations", {
    token: farmer,
    body: { kind: "buyer-farmer", productId, buyerId: buyerRes.data.user.id },
  });
  check("farmer can contact a matched buyer via the existing chat", farmerChat.status === 201, farmerChat.data);

  const farmerChatAgain = await call("POST", "/conversations", {
    token: farmer,
    body: { kind: "buyer-farmer", productId, buyerId: buyerRes.data.user.id },
  });
  check(
    "contacting the same buyer twice reuses the thread",
    farmerChatAgain.data?.conversation?._id === farmerChat.data?.conversation?._id
  );

  const chatNoBuyer = await call("POST", "/conversations", {
    token: farmer,
    body: { kind: "buyer-farmer", productId },
  });
  check("farmer must name a buyer to start a listing chat (400)", chatNoBuyer.status === 400, chatNoBuyer.data);

  const chatOtherProduct = await call("POST", "/conversations", {
    token: farmer2,
    body: { kind: "buyer-farmer", productId, buyerId: buyerRes.data.user.id },
  });
  check(
    "a farmer cannot start a chat from someone else's listing (403)",
    chatOtherProduct.status === 403,
    chatOtherProduct.data
  );

  const buyerChat = await call("POST", "/conversations", {
    token: buyer,
    body: { kind: "buyer-farmer", productId },
  });
  check("the original buyer-started chat flow still works", buyerChat.status === 201, buyerChat.data);
}

// ===========================================================================
(async () => {
  console.log(`\nFarmLink AI matching tests  (${BASE})`);

  layer1();

  const reachable = await fetch(BASE.replace(/\/api$/, "/"))
    .then((r) => r.ok)
    .catch(() => false);

  if (!reachable) {
    console.log("\n  SKIP  backend not running - Layer 2 skipped\n");
  } else {
    await layer2();

    // ---- cleanup ----------------------------------------------------------
    await mongoose.connect(process.env.MONGO_URI);
    const User = require("./models/User");
    const Product = require("./models/Product");
    const Order = require("./models/Order");
    const Conversation = require("./models/Conversation");

    const users = await User.find({ email: new RegExp(`${stamp}@matchtest.local`) });
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
  console.error("\nMATCHING TEST CRASHED:", e);
  process.exit(1);
});
