/**
 * Smoke test for messaging + payment method + delivery instructions.
 * Self-cleaning. Run `node server.js` first, then `node smoke-test-chat.js`.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const BASE = process.env.SMOKE_BASE || "http://localhost:5000/api";
const stamp = Date.now();

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  if (ok) {
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
      email: `${role}.${stamp}@chattest.local`,
      password: "test1234",
      role,
      location: "Delhi",
    },
  });

(async () => {
  console.log(`\nFarmLink chat + payment smoke test  (${BASE})\n`);

  const farmer = (await register("farmer", "Chat Farmer")).data.token;
  const buyer = (await register("buyer", "Chat Buyer")).data.token;
  const driver = (await register("driver", "Chat Driver")).data.token;
  const otherBuyer = (
    await call("POST", "/auth/register", {
      body: {
        name: "Nosy Buyer",
        email: `buyer2.${stamp}@chattest.local`,
        password: "test1234",
        role: "buyer",
        location: "Delhi",
      },
    })
  ).data.token;
  check("three roles registered", !!farmer && !!buyer && !!driver);

  // Farmer lists a crop
  const listed = await call("POST", "/products", {
    token: farmer,
    body: { cropName: "Tomato", quantity: 100, location: "Gurgaon", pricePerKg: 25 },
  });
  const productId = listed.data.product._id;
  check("farmer listed a crop", listed.status === 201);

  // ---- buyer <-> farmer chat from a product listing --------------------
  console.log("\nbuyer <-> farmer (freshness / price)");
  const openBF = await call("POST", "/conversations", {
    token: buyer,
    body: { kind: "buyer-farmer", productId },
  });
  check("buyer opens a chat from the listing", openBF.status === 201, openBF.data);
  const bfId = openBF.data.conversation._id;

  const openBFagain = await call("POST", "/conversations", {
    token: buyer,
    body: { kind: "buyer-farmer", productId },
  });
  check("re-opening returns the SAME thread", openBFagain.data.conversation._id === bfId);

  const m1 = await call("POST", `/conversations/${bfId}/messages`, {
    token: buyer,
    body: { body: "Hi! How fresh are these tomatoes? Can you do 22/kg for 50kg?" },
  });
  check("buyer sends a message", m1.status === 201, m1.data);

  const farmerThreads = await call("GET", "/conversations", { token: farmer });
  check("farmer sees the thread", farmerThreads.data.length === 1, farmerThreads.data);
  check("farmer has 1 unread", farmerThreads.data[0]?.unread === 1, farmerThreads.data[0]);

  const farmerUnread = await call("GET", "/conversations/unread-count", { token: farmer });
  check("unread-count endpoint works", farmerUnread.data.count === 1, farmerUnread.data);

  const farmerRead = await call("GET", `/conversations/${bfId}`, { token: farmer });
  check("farmer reads the thread", farmerRead.data.messages.length === 1);

  const afterRead = await call("GET", "/conversations/unread-count", { token: farmer });
  check("unread clears after opening", afterRead.data.count === 0, afterRead.data);

  const m2 = await call("POST", `/conversations/${bfId}/messages`, {
    token: farmer,
    body: { body: "Picked this morning. I can do 23/kg for 50kg." },
  });
  check("farmer replies", m2.status === 201);

  const nosy = await call("GET", `/conversations/${bfId}`, { token: otherBuyer });
  check("an unrelated buyer cannot read the thread (404)", nosy.status === 404);

  const driverPeek = await call("GET", `/conversations/${bfId}`, { token: driver });
  check("a driver cannot read a buyer/farmer thread (404)", driverPeek.status === 404);

  // ---- order with a prepaid payment method ----------------------------
  console.log("\norder + payment method");
  const order = await call("POST", "/orders", {
    token: buyer,
    body: {
      items: [{ productId, quantity: 50 }],
      deliveryAddress: "Delhi",
      deliveryInstructions: "Ring the bell twice, leave at gate B.",
      paymentMethod: "UPI",
    },
  });
  check("buyer places a UPI order", order.status === 201, order.data);
  check("prepaid order is marked Paid", order.data.order.paymentStatus === "Paid", order.data.order);
  check("delivery instructions saved", order.data.order.deliveryInstructions.includes("bell"));
  const orderId = order.data.order._id;

  const badPay = await call("POST", "/orders", {
    token: buyer,
    body: { items: [{ productId, quantity: 1 }], paymentMethod: "Bitcoin" },
  });
  check("an unknown payment method is rejected (400)", badPay.status === 400, badPay.data);

  const codOrder = await call("POST", "/orders", {
    token: buyer,
    body: { items: [{ productId, quantity: 5 }], paymentMethod: "Cash on Delivery" },
  });
  check("COD order stays Pending payment", codOrder.data.order.paymentStatus === "Pending");

  // buyer updates the delivery note
  const note = await call("PATCH", `/orders/${orderId}/instructions`, {
    token: buyer,
    body: { deliveryInstructions: "Actually call me on arrival." },
  });
  check("buyer edits delivery instructions", note.status === 200 && note.data.order.deliveryInstructions.includes("call"));

  // ---- buyer <-> driver chat (needs an assigned driver) ---------------
  console.log("\nbuyer <-> driver (delivery instructions)");
  const tooEarly = await call("POST", "/conversations", {
    token: buyer,
    body: { kind: "buyer-driver", orderId },
  });
  check("no driver yet -> chat refused (409)", tooEarly.status === 409, tooEarly.data);

  await call("PATCH", `/orders/${orderId}/status`, { token: farmer, body: { status: "Accepted" } });
  await call("PATCH", `/orders/${orderId}/status`, { token: driver, body: { status: "In Transit" } });

  const openBD = await call("POST", "/conversations", {
    token: buyer,
    body: { kind: "buyer-driver", orderId },
  });
  check("buyer opens a chat with the driver", openBD.status === 201, openBD.data);
  const bdId = openBD.data.conversation._id;

  const dm1 = await call("POST", `/conversations/${bdId}/messages`, {
    token: buyer,
    body: { body: "Please use the service lift at the back." },
  });
  check("buyer messages the driver", dm1.status === 201);

  const driverThreads = await call("GET", "/conversations", { token: driver });
  check("driver sees the delivery chat", driverThreads.data.some((c) => c._id === bdId));

  const farmerCantSeeBD = await call("GET", `/conversations/${bdId}`, { token: farmer });
  check("farmer cannot read the buyer/driver thread (404)", farmerCantSeeBD.status === 404);

  const dm2 = await call("POST", `/conversations/${bdId}/messages`, {
    token: driver,
    body: { body: "Got it, 10 minutes away." },
  });
  check("driver replies", dm2.status === 201);

  // delivered -> payment settles for COD
  const del = await call("PATCH", `/orders/${orderId}/status`, {
    token: driver,
    body: { status: "Delivered" },
  });
  check("order delivered", del.status === 200);

  // ---- cleanup -------------------------------------------------------
  await mongoose.connect(process.env.MONGO_URI);
  const User = require("./models/User");
  const Product = require("./models/Product");
  const Order = require("./models/Order");
  const Conversation = require("./models/Conversation");

  const users = await User.find({ email: new RegExp(`${stamp}@chattest.local`) });
  const ids = users.map((u) => u._id);
  await Conversation.deleteMany({ participants: { $in: ids } });
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
