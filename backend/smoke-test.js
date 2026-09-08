/**
 * End-to-end API smoke test. Creates a farmer, a buyer and a driver, walks a
 * crop from listing -> order -> delivery, checks the ownership rules, then
 * deletes everything it created.
 *
 * Usage:  node server.js      (in one terminal)
 *         node smoke-test.js  (in another)
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
    console.log(`  FAIL  ${label}${detail ? ` -> ${JSON.stringify(detail)}` : ""}`);
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

const register = (role, name) =>
  call("POST", "/auth/register", {
    body: {
      name,
      email: `${role}.${stamp}@smoketest.local`,
      password: "test1234",
      role,
      location: "Delhi",
    },
  });

(async () => {
  console.log(`\nFarmLink API smoke test  (${BASE})\n`);

  // ---- auth -------------------------------------------------------------
  console.log("auth");
  const farmerRes = await register("farmer", "Smoke Farmer");
  const buyerRes = await register("buyer", "Smoke Buyer");
  const driverRes = await register("driver", "Smoke Driver");
  const farmer2Res = await call("POST", "/auth/register", {
    body: {
      name: "Other Farmer",
      email: `farmer2.${stamp}@smoketest.local`,
      password: "test1234",
      role: "farmer",
    },
  });

  check("farmer registers + gets token", farmerRes.status === 201 && !!farmerRes.data.token, farmerRes.data);
  check("buyer registers", buyerRes.status === 201, buyerRes.data);
  check("driver role is accepted", driverRes.status === 201, driverRes.data);
  check("password hash is never returned", !JSON.stringify(farmerRes.data).includes("password"));

  const farmer = farmerRes.data.token;
  const buyer = buyerRes.data.token;
  const driver = driverRes.data.token;
  const farmer2 = farmer2Res.data.token;

  const dupe = await register("farmer", "Dupe");
  check("duplicate email is rejected (409)", dupe.status === 409, dupe.data);

  const badLogin = await call("POST", "/auth/login", {
    body: { email: `farmer.${stamp}@smoketest.local`, password: "wrongpass" },
  });
  check("wrong password is rejected (401)", badLogin.status === 401);

  const goodLogin = await call("POST", "/auth/login", {
    body: { email: `farmer.${stamp}@smoketest.local`, password: "test1234" },
  });
  check("login returns a token", goodLogin.status === 200 && !!goodLogin.data.token);

  const me = await call("GET", "/auth/me", { token: farmer });
  check("GET /auth/me restores the session", me.status === 200 && me.data.user.role === "farmer");

  const noToken = await call("GET", "/auth/me");
  check("GET /auth/me without a token is 401", noToken.status === 401);

  // ---- products ---------------------------------------------------------
  console.log("\nproducts");
  const created = await call("POST", "/products", {
    token: farmer,
    body: { cropName: "SmokeTomato", quantity: 100, location: "Gurgaon", pricePerKg: 25 },
  });
  check("farmer creates a crop WITHOUT sending farmerId", created.status === 201, created.data);
  check("farmerId is filled in from the token", !!created.data.product?.farmerId, created.data);

  const productId = created.data.product?._id;

  const asBuyer = await call("POST", "/products", {
    token: buyer,
    body: { cropName: "Nope", quantity: 10, location: "Delhi", pricePerKg: 5 },
  });
  check("a buyer cannot create a crop (403)", asBuyer.status === 403, asBuyer.data);

  const anon = await call("POST", "/products", {
    body: { cropName: "Nope", quantity: 10, location: "Delhi", pricePerKg: 5 },
  });
  check("an anonymous user cannot create a crop (401)", anon.status === 401);

  const badQty = await call("POST", "/products", {
    token: farmer,
    body: { cropName: "Bad", quantity: -5, location: "Delhi", pricePerKg: 20 },
  });
  check("negative quantity is rejected (400)", badQty.status === 400, badQty.data);

  await call("POST", "/products", {
    token: farmer2,
    body: { cropName: "OtherFarmerCrop", quantity: 50, location: "Noida", pricePerKg: 30 },
  });

  const mine = await call("GET", "/products/mine", { token: farmer });
  check("GET /products/mine returns only my crops", mine.data.every((p) => p.cropName === "SmokeTomato"), mine.data.map((p) => p.cropName));

  const all = await call("GET", "/products");
  check("public listing shows every farmer's crops", all.data.length >= 2);

  const edit = await call("PATCH", `/products/${productId}`, {
    token: farmer,
    body: { pricePerKg: 28 },
  });
  check("farmer edits own crop", edit.status === 200 && edit.data.product.pricePerKg === 28, edit.data);

  const foreignEdit = await call("PATCH", `/products/${productId}`, {
    token: farmer2,
    body: { pricePerKg: 1 },
  });
  check("another farmer cannot edit it (403)", foreignEdit.status === 403, foreignEdit.data);

  const foreignDelete = await call("DELETE", `/products/${productId}`, { token: farmer2 });
  check("another farmer cannot delete it (403)", foreignDelete.status === 403, foreignDelete.data);

  const stats = await call("GET", "/products/stats", { token: farmer });
  check("farmer stats counts only own crops", stats.data.totalProducts === 1, stats.data);

  // ---- orders -----------------------------------------------------------
  console.log("\norders");
  const order = await call("POST", "/orders", {
    token: buyer,
    body: { items: [{ productId, quantity: 10 }], deliveryAddress: "Delhi" },
  });
  check("buyer places an order", order.status === 201, order.data);
  check("server computes the total from db prices (10 x 28)", order.data.order?.totalAmount === 280, order.data.order?.totalAmount);

  const orderId = order.data.order?._id;

  const afterOrder = await call("GET", `/products/${productId}`);
  check("stock is reduced 100 -> 90", afterOrder.data.quantity === 90, afterOrder.data.quantity);

  const overOrder = await call("POST", "/orders", {
    token: buyer,
    body: { items: [{ productId, quantity: 5000 }] },
  });
  check("ordering more than stock is rejected (409)", overOrder.status === 409, overOrder.data);

  const farmerOrders = await call("GET", "/orders", { token: farmer });
  check("farmer sees the order containing their crop", farmerOrders.data.length === 1, farmerOrders.data.length);

  const farmer2Orders = await call("GET", "/orders", { token: farmer2 });
  check("unrelated farmer sees no orders", farmer2Orders.data.length === 0, farmer2Orders.data.length);

  const buyerOrders = await call("GET", "/orders", { token: buyer });
  check("buyer sees their own order", buyerOrders.data.length === 1);

  const badJump = await call("PATCH", `/orders/${orderId}/status`, {
    token: driver,
    body: { status: "Delivered" },
  });
  check("driver cannot skip Pending -> Delivered (400)", badJump.status === 400, badJump.data);

  const buyerAccept = await call("PATCH", `/orders/${orderId}/status`, {
    token: buyer,
    body: { status: "Accepted" },
  });
  check("buyer cannot accept their own order (400)", buyerAccept.status === 400);

  const accept = await call("PATCH", `/orders/${orderId}/status`, {
    token: farmer,
    body: { status: "Accepted" },
  });
  check("farmer accepts the order", accept.status === 200, accept.data);

  const transit = await call("PATCH", `/orders/${orderId}/status`, {
    token: driver,
    body: { status: "In Transit" },
  });
  check("driver starts the delivery", transit.status === 200, transit.data);

  const gps = await call("PATCH", `/orders/${orderId}/location`, {
    token: driver,
    body: { latitude: 28.61, longitude: 77.2 },
  });
  check("driver pushes a GPS ping", gps.status === 200, gps.data);

  const lateCancel = await call("PATCH", `/orders/${orderId}/cancel`, { token: buyer });
  check("buyer cannot cancel once In Transit (400)", lateCancel.status === 400, lateCancel.data);

  const deleteLive = await call("DELETE", `/products/${productId}`, { token: farmer });
  check("crop in a live order cannot be deleted (409)", deleteLive.status === 409, deleteLive.data);

  const delivered = await call("PATCH", `/orders/${orderId}/status`, {
    token: driver,
    body: { status: "Delivered" },
  });
  check("driver marks it delivered", delivered.status === 200, delivered.data);

  const orderStats = await call("GET", "/orders/stats", { token: farmer });
  check("farmer earnings reflect the delivered order", orderStats.data.completedValue === 280, orderStats.data);

  // ---- route optimisation ----------------------------------------------
  console.log("\nroute optimisation");
  const optimise = await call("POST", "/routes/optimize", {
    body: {
      start: { location: "Delhi" },
      roundTrip: true,
      stops: [
        { label: "A", location: "Gurgaon" },
        { label: "B", location: "Ghaziabad" },
        { label: "C", location: "Faridabad" },
      ],
    },
  });
  check("optimizer returns a shorter route", optimise.data.totalDistanceKm <= optimise.data.naiveDistanceKm, optimise.data.totalDistanceKm);

  const driverRoute = await call("POST", "/routes/optimize-orders", {
    token: buyer,
    body: { start: { location: "Delhi" } },
  });
  check("only a driver can optimise order routes (403)", driverRoute.status === 403, driverRoute.data);

  // ---- cleanup ----------------------------------------------------------
  await mongoose.connect(process.env.MONGO_URI);
  const User = require("./models/User");
  const Product = require("./models/Product");
  const Order = require("./models/Order");

  const users = await User.find({ email: new RegExp(`${stamp}@smoketest.local`) });
  const ids = users.map((u) => u._id);
  await Order.deleteMany({ buyerId: { $in: ids } });
  await Product.deleteMany({ farmerId: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
  await mongoose.disconnect();

  console.log(`\ncleaned up ${users.length} test users and their data`);
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error("\nSMOKE TEST CRASHED:", e);
  process.exit(1);
});
