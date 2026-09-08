/**
 * Replays the exact API calls the React app makes, for all three roles,
 * to prove every screen's data flow works end to end. Self-cleaning.
 *
 * Usage:  node server.js               (terminal 1)
 *         node smoke-test-journey.js   (terminal 2)
 */
require("dotenv").config();
const mongoose = require("mongoose");

const BASE = "http://localhost:5000/api";
const ML = "http://localhost:8000";
const stamp = Date.now();

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  }
}

async function call(method, path, { token, body, base = BASE } = {}) {
  const res = await fetch(base + path, {
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
    /* empty body */
  }
  return { status: res.status, data };
}

(async () => {
  console.log(`\nFarmLink UI journey test\n`);

  // ---- Register screen: three roles ------------------------------------
  console.log("Register / Login screens");
  const mk = (role) =>
    call("POST", "/auth/register", {
      body: {
        name: `Journey ${role}`,
        email: `${role}.j${stamp}@smoketest.local`,
        password: "test1234",
        role,
        location: "Delhi",
      },
    });

  const farmerReg = await mk("farmer");
  const buyerReg = await mk("buyer");
  const driverReg = await mk("driver");

  const farmer = farmerReg.data.token;
  const buyer = buyerReg.data.token;
  const driver = driverReg.data.token;

  check("farmer signs up and lands with a token", !!farmer);
  check("buyer signs up", !!buyer);
  check("driver signs up", !!driver);
  check("farmer redirect target is /farmer", farmerReg.data.user.role === "farmer");
  check("buyer redirect target is /buyer", buyerReg.data.user.role === "buyer");
  check("driver redirect target is /driver", driverReg.data.user.role === "driver");

  // Session restore (what AuthProvider does on boot)
  const restore = await call("GET", "/auth/me", { token: farmer });
  check("session restores on refresh", restore.data.user.email.includes(String(stamp)));

  // ---- Farmer: My Crops screen -----------------------------------------
  console.log("\nFarmer › My Crops (the screen that was broken)");
  const crops = [
    { cropName: "Tomato", quantity: 200, location: "Gurgaon", pricePerKg: 26, unit: "kg" },
    { cropName: "Onion", quantity: 150, location: "Noida", pricePerKg: 30, unit: "kg" },
    { cropName: "Potato", quantity: 300, location: "Ghaziabad", pricePerKg: 22, unit: "kg" },
  ];

  const created = [];
  for (const crop of crops) {
    const res = await call("POST", "/products", { token: farmer, body: crop });
    created.push(res.data.product);
    check(`add "${crop.cropName}" succeeds (no farmerId sent)`, res.status === 201, res.data);
  }

  const mine = await call("GET", "/products/mine", { token: farmer });
  check("listing shows all 3 of my crops", mine.data.length === 3, mine.data.length);
  check(
    "listing contains ONLY my crops",
    mine.data.every((p) => String(p.farmerId) === String(farmerReg.data.user.id))
  );

  const edited = await call("PATCH", `/products/${created[0]._id}`, {
    token: farmer,
    body: { pricePerKg: 29, quantity: 180 },
  });
  check("edit a listing", edited.data.product?.pricePerKg === 29, edited.data);

  const removed = await call("DELETE", `/products/${created[2]._id}`, { token: farmer });
  check("delete a listing succeeds", removed.status === 200, removed.data);

  const afterDelete = await call("GET", "/products/mine", { token: farmer });
  check("deleted crop is gone from the list", afterDelete.data.length === 2, afterDelete.data.length);

  const dashStats = await call("GET", "/products/stats", { token: farmer });
  check("farmer dashboard stats are scoped to me", dashStats.data.totalProducts === 2, dashStats.data);

  // ---- Buyer: Marketplace -> Cart -> Orders -----------------------------
  console.log("\nBuyer › Marketplace, Cart, Orders");
  const market = await call("GET", "/products?inStock=true");
  check("marketplace lists in-stock crops", market.data.length >= 2);

  const placed = await call("POST", "/orders", {
    token: buyer,
    body: {
      items: [
        { productId: created[0]._id, quantity: 10 },
        { productId: created[1]._id, quantity: 5 },
      ],
      deliveryAddress: "Connaught Place, Delhi",
    },
  });
  check("checkout creates an order", placed.status === 201, placed.data);
  check(
    "total computed server-side (10x29 + 5x30 = 440)",
    placed.data.order?.totalAmount === 440,
    placed.data.order?.totalAmount
  );

  const orderId = placed.data.order._id;

  const buyerOrders = await call("GET", "/orders", { token: buyer });
  check("My Orders shows the new order", buyerOrders.data.length === 1);

  const buyerStats = await call("GET", "/orders/stats", { token: buyer });
  check("buyer dashboard stats work", buyerStats.data.total === 1, buyerStats.data);

  // ---- Farmer: Incoming orders -----------------------------------------
  console.log("\nFarmer › Incoming orders");
  const incoming = await call("GET", "/orders", { token: farmer });
  check("farmer sees the incoming order", incoming.data.length === 1);
  check(
    "farmer sees only their own lines and total",
    incoming.data[0].totalAmount === 440,
    incoming.data[0].totalAmount
  );

  const accepted = await call("PATCH", `/orders/${orderId}/status`, {
    token: farmer,
    body: { status: "Accepted" },
  });
  check("Accept button works", accepted.status === 200, accepted.data);

  // ---- Driver: route + delivery ----------------------------------------
  console.log("\nDriver › Optimised route and delivery");
  const route = await call("POST", "/routes/optimize-orders", {
    token: driver,
    body: { start: { lat: 28.6139, lng: 77.209, label: "FarmLink Depot" }, roundTrip: true },
  });
  check("driver gets an optimised route", route.status === 200, route.data);
  check("route has waypoints to draw", (route.data.waypoints || []).length >= 3);
  check(
    "route is no longer than the naive order",
    route.data.totalDistanceKm <= route.data.naiveDistanceKm
  );

  const started = await call("PATCH", `/orders/${orderId}/status`, {
    token: driver,
    body: { status: "In Transit" },
  });
  check("Start delivery button works", started.status === 200, started.data);

  const ping = await call("PATCH", `/orders/${orderId}/location`, {
    token: driver,
    body: { latitude: 28.62, longitude: 77.21 },
  });
  check("GPS ping saves", ping.status === 200);

  const tracking = await call("GET", "/orders", { token: buyer });
  check(
    "buyer can now see the live driver position",
    tracking.data[0].driverLocation?.latitude === 28.62,
    tracking.data[0].driverLocation
  );

  const done = await call("PATCH", `/orders/${orderId}/status`, {
    token: driver,
    body: { status: "Delivered" },
  });
  check("Mark delivered button works", done.status === 200, done.data);

  const finalFarmerStats = await call("GET", "/orders/stats", { token: farmer });
  check("farmer earnings updated to 440", finalFarmerStats.data.completedValue === 440, finalFarmerStats.data);

  // ---- Shared screens ---------------------------------------------------
  console.log("\nShared screens (all roles)");
  for (const [role, token] of [["farmer", farmer], ["buyer", buyer], ["driver", driver]]) {
    const shared = await call("GET", "/products");
    check(`${role} can open the shared Marketplace`, shared.status === 200);
    const profile = await call("PATCH", "/auth/me", {
      token,
      body: { phone: "9876543210", location: "Delhi" },
    });
    check(`${role} can update their Profile`, profile.data.user?.phone === "9876543210", profile.data);
  }

  try {
    const insights = await call("POST", "/demand-insights", {
      base: ML,
      body: { location: "Delhi" },
    });
    check("AI Insights panel gets data", (insights.data.insights || []).length > 0);
  } catch {
    console.log("  SKIP  AI Insights (ml-service not running)");
  }

  // ---- Cleanup ----------------------------------------------------------
  await mongoose.connect(process.env.MONGO_URI);
  const User = require("./models/User");
  const Product = require("./models/Product");
  const Order = require("./models/Order");

  const users = await User.find({ email: new RegExp(`j${stamp}@smoketest.local`) });
  const ids = users.map((u) => u._id);
  await Order.deleteMany({ buyerId: { $in: ids } });
  await Product.deleteMany({ farmerId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
  await mongoose.disconnect();

  console.log(`\ncleaned up ${users.length} test users and their data`);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error("\nJOURNEY TEST CRASHED:", e);
  process.exit(1);
});
