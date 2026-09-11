/**
 * Delivery routing and order tracking tests.
 *
 *   Layer 1  the pickup-and-delivery planner, in-process
 *   Layer 2  the live API: route planning + per-order tracking + authorization
 *
 * Covers the three defects this work fixed:
 *   1. routes ignored the buyer's delivery address (farm-only stops)
 *   2. nothing stopped a delivery being scheduled before its own pickup
 *   3. any driver account could move the dot on any order's tracking map
 *
 * Usage:  node server.js               (in one terminal)
 *         node smoke-test-delivery.js  (in another)
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

const register = (role, name, location) =>
  call("POST", "/auth/register", {
    body: {
      name,
      email: `${name.toLowerCase().replace(/\W+/g, "")}.${stamp}@deliverytest.local`,
      password: "test1234",
      role,
      location,
    },
  });

// ===========================================================================
// Layer 1 - the planner on its own
// ===========================================================================
function layer1() {
  console.log("\nLayer 1: pickup-and-delivery planner\n");

  const {
    optimizePickupDelivery,
    precedenceHolds,
    haversineKm,
  } = require("./utils/routeOptimizer");
  const { geocode } = require("./utils/geocode");

  const at = (city, label) => ({ ...geocode(city), label });

  const jobs = [
    { orderId: "A", crop: "Tomato", pickup: at("Sonipat", "Farm A"), dropoff: at("Faridabad", "Buyer A") },
    { orderId: "B", crop: "Onion", pickup: at("Panipat", "Farm B"), dropoff: at("Noida", "Buyer B") },
    { orderId: "C", crop: "Potato", pickup: at("Meerut", "Farm C"), dropoff: at("Gurgaon", "Buyer C") },
  ];

  const plan = optimizePickupDelivery({
    start: at("Delhi", "Depot"),
    jobs,
    roundTrip: false,
  });

  check("plan visits two stops per order", plan.stopCount === jobs.length * 2, plan.stopCount);
  check("plan reports the order count", plan.jobCount === jobs.length);

  const posOf = {};
  plan.stops.forEach((stop, index) => {
    posOf[`${stop.type}:${stop.orderId}`] = index;
  });

  check(
    "every pickup is planned before its own delivery",
    jobs.every((job) => posOf[`pickup:${job.orderId}`] < posOf[`dropoff:${job.orderId}`]),
    plan.stops.map((s) => `${s.type}:${s.orderId}`)
  );

  check(
    "both a pickup and a delivery exist for every order",
    jobs.every(
      (job) =>
        posOf[`pickup:${job.orderId}`] !== undefined &&
        posOf[`dropoff:${job.orderId}`] !== undefined
    )
  );

  check(
    "the optimised route is no longer than the naive one",
    plan.totalDistanceKm <= plan.naiveDistanceKm,
    [plan.totalDistanceKm, plan.naiveDistanceKm]
  );
  check("the saving is reported", plan.improvementPct >= 0 && plan.distanceSavedKm >= 0);
  check(
    "waypoints cover start plus every stop",
    plan.waypoints.length === plan.stopCount + 1,
    plan.waypoints.length
  );

  // The leg distances must add up to the headline number.
  const legSum = plan.legs.reduce((total, leg) => total + leg.distanceKm, 0);
  check(
    "leg distances sum to the total distance",
    Math.abs(legSum - plan.totalDistanceKm) < 0.05,
    [legSum, plan.totalDistanceKm]
  );

  // Running totals must never go backwards.
  const cumulative = plan.stops.map((s) => s.cumulativeKm);
  check(
    "cumulative distance increases along the route",
    cumulative.every((km, i) => i === 0 || km >= cumulative[i - 1]),
    cumulative
  );
  const etas = plan.stops.map((s) => s.etaMinutes);
  check(
    "ETA increases along the route",
    etas.every((min, i) => i === 0 || min >= etas[i - 1]),
    etas
  );

  // The precedence guard itself.
  const meta = [null, { jobIndex: 0, type: "pickup" }, { jobIndex: 0, type: "dropoff" }];
  check("precedence guard accepts pickup-then-dropoff", precedenceHolds([0, 1, 2], meta));
  check("precedence guard rejects dropoff-then-pickup", !precedenceHolds([0, 2, 1], meta));

  // Round trip returns home.
  const loop = optimizePickupDelivery({ start: at("Delhi", "Depot"), jobs, roundTrip: true });
  const first = loop.waypoints[0];
  const last = loop.waypoints[loop.waypoints.length - 1];
  check(
    "a round trip finishes back at the start",
    first.lat === last.lat && first.lng === last.lng
  );
  check("a round trip is at least as long as a one-way run", loop.totalDistanceKm >= plan.totalDistanceKm);

  // A single order still works.
  const single = optimizePickupDelivery({ start: at("Delhi", "Depot"), jobs: [jobs[0]], roundTrip: false });
  check("a single order produces two stops", single.stopCount === 2, single.stopCount);
  check(
    "a single order goes pickup then delivery",
    single.stops[0].type === "pickup" && single.stops[1].type === "dropoff"
  );

  // Bad input is refused rather than producing nonsense.
  let threw = false;
  try {
    optimizePickupDelivery({ start: at("Delhi", "Depot"), jobs: [] });
  } catch {
    threw = true;
  }
  check("an empty job list is rejected", threw);

  // Distance sanity against a known pair.
  const delhiMumbai = haversineKm(geocode("Delhi"), geocode("Mumbai"));
  check(
    "haversine gives a sane Delhi-Mumbai distance (~1150 km)",
    delhiMumbai > 1050 && delhiMumbai < 1250,
    Math.round(delhiMumbai)
  );

  // Many orders: precedence must still hold after 2-opt has churned.
  const manyJobs = ["Sonipat", "Panipat", "Meerut", "Noida", "Ghaziabad"].map((city, i) => ({
    orderId: `M${i}`,
    pickup: at(city, `Farm ${i}`),
    dropoff: at(["Gurgaon", "Faridabad", "Delhi", "Noida", "Meerut"][i], `Buyer ${i}`),
  }));
  const bigPlan = optimizePickupDelivery({ start: at("Delhi", "Depot"), jobs: manyJobs, roundTrip: true });
  const bigPos = {};
  bigPlan.stops.forEach((s, i) => {
    bigPos[`${s.type}:${s.orderId}`] = i;
  });
  check(
    "precedence survives 2-opt on a 5-order run",
    manyJobs.every((j) => bigPos[`pickup:${j.orderId}`] < bigPos[`dropoff:${j.orderId}`]),
    bigPlan.stops.map((s) => `${s.type}:${s.orderId}`)
  );
  check(
    "a 5-order run still beats the naive plan",
    bigPlan.totalDistanceKm <= bigPlan.naiveDistanceKm,
    [bigPlan.totalDistanceKm, bigPlan.naiveDistanceKm]
  );
}

// ===========================================================================
// Layer 2 - the live API
// ===========================================================================
async function layer2() {
  console.log("\nLayer 2: live routing and tracking API\n");

  const farmerRes = await register("farmer", "DelFarmer", "Sonipat");
  const buyerRes = await register("buyer", "DelBuyer", "Faridabad");
  const driverRes = await register("driver", "DelDriver", "Delhi");
  const otherDriverRes = await register("driver", "NosyDriver", "Delhi");
  const otherBuyerRes = await register("buyer", "NosyBuyer", "Delhi");

  const farmer = farmerRes.data.token;
  const buyer = buyerRes.data.token;
  const driver = driverRes.data.token;
  const otherDriver = otherDriverRes.data.token;
  const otherBuyer = otherBuyerRes.data.token;

  check("test accounts created", !!(farmer && buyer && driver && otherDriver));

  // Farm in Sonipat, delivery to Gurgaon - two clearly different places.
  const productRes = await call("POST", "/products", {
    token: farmer,
    body: { cropName: "Tomato", quantity: 500, location: "Sonipat", pricePerKg: 30 },
  });
  const productId = productRes.data.product?._id;
  check("farmer lists a crop in Sonipat", productRes.status === 201, productRes.data);

  const orderRes = await call("POST", "/orders", {
    token: buyer,
    body: {
      items: [{ productId, quantity: 20 }],
      deliveryAddress: "Sector 45, Gurgaon",
    },
  });
  const orderId = orderRes.data.order?._id;
  check("buyer orders it to a Gurgaon address", orderRes.status === 201, orderRes.data);

  await call("PATCH", `/orders/${orderId}/status`, { token: farmer, body: { status: "Accepted" } });

  // ---- route planning ----------------------------------------------------
  const route = await call("POST", "/routes/optimize-orders", {
    token: driver,
    body: { start: { location: "Delhi", label: "Depot" }, roundTrip: true },
  });
  check("driver gets a route plan", route.status === 200, route.data);

  const stops = route.data?.stops || [];
  const mine = stops.filter((s) => String(s.orderId) === String(orderId));

  check("the order contributes two stops, not one", mine.length === 2, mine.length);
  check(
    "one is a pickup and one is a delivery",
    mine.some((s) => s.type === "pickup") && mine.some((s) => s.type === "dropoff"),
    mine.map((s) => s.type)
  );

  const pickup = mine.find((s) => s.type === "pickup");
  const dropoff = mine.find((s) => s.type === "dropoff");

  check(
    "the pickup is at the farm",
    /sonipat/i.test(pickup?.place || ""),
    pickup?.place
  );
  check(
    "the delivery uses the address the buyer gave",
    /gurgaon/i.test(dropoff?.place || ""),
    dropoff?.place
  );
  check(
    "pickup and delivery are at different coordinates",
    pickup && dropoff && (pickup.lat !== dropoff.lat || pickup.lng !== dropoff.lng),
    [pickup?.lat, dropoff?.lat]
  );
  check(
    "the pickup is sequenced before the delivery",
    pickup.sequence < dropoff.sequence,
    [pickup.sequence, dropoff.sequence]
  );
  check(
    "the plan names its algorithm",
    typeof route.data.algorithm === "string" && /precedence/i.test(route.data.algorithm),
    route.data.algorithm
  );
  check(
    "the optimised route is no longer than the naive one",
    route.data.totalDistanceKm <= route.data.naiveDistanceKm,
    [route.data.totalDistanceKm, route.data.naiveDistanceKm]
  );
  check("waypoints are drawable", (route.data.waypoints || []).length >= 3);

  const buyerRoute = await call("POST", "/routes/optimize-orders", {
    token: buyer,
    body: { start: { location: "Delhi" } },
  });
  check("a buyer cannot plan driver routes (403)", buyerRoute.status === 403, buyerRoute.data);

  // ---- tracking before dispatch -------------------------------------------
  const early = await call("GET", `/orders/${orderId}/tracking`, { token: buyer });
  check("buyer can track before dispatch", early.status === 200, early.data);
  check(
    "tracking knows both ends of the journey",
    /sonipat/i.test(early.data?.pickup?.place || "") &&
      /gurgaon/i.test(early.data?.dropoff?.place || ""),
    [early.data?.pickup?.place, early.data?.dropoff?.place]
  );
  check("tracking reports no live location yet", early.data?.hasLiveLocation === false);
  check("tracking lists the delivery stages", (early.data?.stages || []).length >= 4);
  check(
    "stages mark 'accepted' done and 'delivered' not done",
    early.data.stages.find((s) => s.key === "accepted")?.done === true &&
      early.data.stages.find((s) => s.key === "delivered")?.done === false,
    early.data.stages.map((s) => [s.key, s.done])
  );
  check(
    "progress is 0 before the parcel moves",
    early.data?.progressPct === 0,
    early.data?.progressPct
  );

  // ---- authorization on tracking -----------------------------------------
  const nosy = await call("GET", `/orders/${orderId}/tracking`, { token: otherBuyer });
  check("another buyer cannot track this order (403)", nosy.status === 403, nosy.data);

  const anon = await call("GET", `/orders/${orderId}/tracking`);
  check("tracking requires a login (401)", anon.status === 401, anon.data);

  const farmerTrack = await call("GET", `/orders/${orderId}/tracking`, { token: farmer });
  check("the fulfilling farmer can track it", farmerTrack.status === 200, farmerTrack.status);

  const badTrack = await call("GET", "/orders/not-an-id/tracking", { token: buyer });
  check("an invalid order id is rejected (400)", badTrack.status === 400, badTrack.data);

  const missingTrack = await call("GET", `/orders/${"5".repeat(24)}/tracking`, { token: buyer });
  check("an unknown order returns 404", missingTrack.status === 404, missingTrack.data);

  // ---- dispatch and live position ----------------------------------------
  await call("PATCH", `/orders/${orderId}/status`, { token: driver, body: { status: "In Transit" } });

  // Somewhere between Sonipat and Gurgaon.
  const ping = await call("PATCH", `/orders/${orderId}/location`, {
    token: driver,
    body: { latitude: 28.7, longitude: 77.1 },
  });
  check("the assigned driver can report a position", ping.status === 200, ping.data);

  const hijack = await call("PATCH", `/orders/${orderId}/location`, {
    token: otherDriver,
    body: { latitude: 1, longitude: 1 },
  });
  check(
    "another driver cannot move the dot on this order (403)",
    hijack.status === 403,
    hijack.data
  );

  const badPing = await call("PATCH", `/orders/${orderId}/location`, {
    token: driver,
    body: { latitude: "somewhere", longitude: null },
  });
  check("a non-numeric position is rejected (400)", badPing.status === 400, badPing.data);

  const live = await call("GET", `/orders/${orderId}/tracking`, { token: buyer });
  check("tracking now reports a live location", live.data?.hasLiveLocation === true, live.data);
  check(
    "the driver marker is where the driver said",
    live.data?.driver?.lat === 28.7 && live.data?.driver?.lng === 77.1,
    live.data?.driver
  );
  check(
    "progress is now between 0 and 100",
    live.data?.progressPct > 0 && live.data?.progressPct < 100,
    live.data?.progressPct
  );
  check(
    "remaining distance and ETA are reported",
    live.data?.remainingKm >= 0 && live.data?.etaMinutes >= 0,
    [live.data?.remainingKm, live.data?.etaMinutes]
  );
  check(
    "the 'out for delivery' stage is now current",
    live.data.stages.find((s) => s.key === "transit")?.current === true,
    live.data.stages.map((s) => [s.key, s.current])
  );

  // ---- delivered ----------------------------------------------------------
  await call("PATCH", `/orders/${orderId}/status`, { token: driver, body: { status: "Delivered" } });
  const done = await call("GET", `/orders/${orderId}/tracking`, { token: buyer });
  check("a delivered order tracks as complete", done.data?.status === "Delivered");
  check(
    "every stage is done once delivered",
    (done.data?.stages || []).every((s) => s.done),
    done.data?.stages?.map((s) => [s.key, s.done])
  );

  // ---- nothing private leaks ----------------------------------------------
  const serialised = JSON.stringify(live.data);
  check("tracking never exposes a password", !serialised.includes("password"));
  check("tracking never exposes an email", !serialised.includes("@deliverytest.local"));
}

// ===========================================================================
(async () => {
  console.log(`\nFarmLink delivery routing + tracking tests  (${BASE})`);

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

    const users = await User.find({ email: new RegExp(`${stamp}@deliverytest.local`) });
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
  console.error("\nDELIVERY TEST CRASHED:", e);
  process.exit(1);
});
