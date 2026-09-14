/**
 * End-to-end test of the operations layer: fees and escrow, carrier dispatch,
 * two-point quality inspection, disputes, wholesale accounts and invoices, the
 * partner API, the admin console and the audit trail.
 *
 * It creates its own farmer, buyers, drivers, two logistics companies and an
 * admin, trades between Bhopal and Indore (cities no other suite uses, so its
 * carriers cannot pick up other suites' orders), then deletes everything and
 * restores any platform setting it touched.
 *
 * Usage:  node server.js                  (in one terminal)
 *         node smoke-test-operations.js   (in another)
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const BASE = process.env.SMOKE_BASE || "http://localhost:5000/api";
const stamp = Date.now();
const DOMAIN = "opstest.local";

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
}

async function call(method, path, { token, body, apiKey } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

const register = async (role, key, location) => {
  const res = await call("POST", "/auth/register", {
    body: {
      name: `Ops ${key}`,
      email: `${key}.${stamp}@${DOMAIN}`,
      password: "test1234",
      role,
      location,
    },
  });
  return { token: res.data?.token, id: res.data?.user?.id || res.data?.user?._id, status: res.status };
};

const PICKUP_OK = { grade: "A", checks: { freshness: true, pestFree: true, packaging: true, moistureOk: true } };

let originalSettings = null;
let adminToken = null;

(async () => {
  console.log(`\nFarmLink operations smoke test  (${BASE})\n`);
  await mongoose.connect(process.env.MONGO_URI);
  const User = require("./models/User");

  try {
    // ---- accounts ------------------------------------------------------------
    console.log("accounts and access");
    const farmer = await register("farmer", "farmer", "Bhopal");
    const buyer = await register("buyer", "buyer", "Indore");
    const bizBuyer = await register("buyer", "biz", "Indore");
    const carrierA = await register("logistics", "carrierA", "Bhopal");
    const carrierB = await register("logistics", "carrierB", "Bhopal");
    const driverA = await register("driver", "driverA", "Bhopal");
    const driverB = await register("driver", "driverB", "Bhopal");
    const freelancer = await register("driver", "freelancer", "Bhopal");

    check("a logistics company can sign up", carrierA.status === 201, carrierA.status);
    const selfAdmin = await call("POST", "/auth/register", {
      body: { name: "Sneaky", email: `sneaky.${stamp}@${DOMAIN}`, password: "test1234", role: "admin" },
    });
    check("nobody can register themselves as admin (400)", selfAdmin.status === 400, selfAdmin.data);

    await User.create({
      name: "Ops Admin",
      email: `admin.${stamp}@${DOMAIN}`,
      password: await bcrypt.hash("admin-password-123", 10),
      role: "admin",
    });
    const adminLogin = await call("POST", "/auth/login", {
      body: { email: `admin.${stamp}@${DOMAIN}`, password: "admin-password-123" },
    });
    adminToken = adminLogin.data?.token;
    check("an admin created on the server can log in", !!adminToken, adminLogin.data);

    const buyerAdmin = await call("GET", "/admin/overview", { token: buyer.token });
    check("a buyer cannot open the admin console (403)", buyerAdmin.status === 403, buyerAdmin.status);
    const carrierOrders = await call("GET", "/orders", { token: carrierA.token });
    check(
      "a logistics company never sees the raw order list",
      carrierOrders.status === 200 && Array.isArray(carrierOrders.data) && carrierOrders.data.length === 0,
      carrierOrders.data
    );

    // ---- platform settings ---------------------------------------------------
    console.log("\nplatform settings");
    const settingsRes = await call("GET", "/admin/settings", { token: adminToken });
    originalSettings = settingsRes.data?.settings;
    check("admin reads the platform settings", settingsRes.status === 200 && !!originalSettings?.fees);

    const badSettings = await call("PUT", "/admin/settings", {
      token: adminToken,
      body: { fees: { consumer: { commissionPct: 99 } } },
    });
    check("an out-of-bounds fee is refused (400)", badSettings.status === 400, badSettings.data);

    const pinned = await call("PUT", "/admin/settings", {
      token: adminToken,
      body: {
        fees: {
          consumer: { commissionPct: 4, logisticsMarkupPct: 8 },
          business: { commissionPct: 2.5, logisticsMarkupPct: 6 },
        },
        inspection: { requirePickupInspection: true, weightTolerancePct: 5 },
        b2b: { minLineQuantityKg: 50 },
      },
    });
    check("admin pins the fees this test expects", pinned.status === 200, pinned.data);

    // ---- listing with volume pricing ----------------------------------------
    console.log("\nlisting with bulk tiers");
    const badTier = await call("POST", "/products", {
      token: farmer.token,
      body: {
        cropName: "Tomato",
        quantity: 3000,
        location: "Bhopal",
        pricePerKg: 30,
        bulkTiers: [{ minQuantityKg: 100, pricePerKg: 31 }],
      },
    });
    check("a bulk price above the base price is refused (400)", badTier.status === 400, badTier.data);

    const listing = await call("POST", "/products", {
      token: farmer.token,
      body: {
        cropName: "Tomato",
        quantity: 3000,
        location: "Bhopal",
        pricePerKg: 30,
        bulkTiers: [
          { minQuantityKg: 500, pricePerKg: 25 },
          { minQuantityKg: 100, pricePerKg: 27 },
        ],
      },
    });
    const productId = listing.data?.product?._id;
    check("farmer lists a crop with bulk tiers", listing.status === 201 && !!productId, listing.data);
    check(
      "tiers are stored in quantity order",
      listing.data?.product?.bulkTiers?.[0]?.minQuantityKg === 100,
      listing.data?.product?.bulkTiers
    );

    // ---- logistics companies -------------------------------------------------
    console.log("\nlogistics companies");
    const companyBody = (name) => ({
      name,
      coverageCities: ["Bhopal", "Indore"],
      rateCard: { baseFee: 50, perKm: 5, perKg: 0.2, minFee: 60 },
      liability: { coveragePct: 80, maxPerOrder: 20000 },
      maxLoadKg: 5000,
    });
    const companyA = await call("PUT", "/logistics/provider/me", { token: carrierA.token, body: companyBody(`Ops Freight A ${stamp}`) });
    const companyB = await call("PUT", "/logistics/provider/me", { token: carrierB.token, body: companyBody(`Ops Freight B ${stamp}`) });
    check("two carriers create company profiles", companyA.status === 201 && companyB.status === 201, [companyA.data, companyB.data]);
    check("a new company starts unverified", companyA.data?.provider?.verified === false);

    const badRate = await call("PUT", "/logistics/provider/me", {
      token: carrierA.token,
      body: { rateCard: { perKm: -1 } },
    });
    check("a negative rate is refused (400)", badRate.status === 400, badRate.data);

    const wrongCode = await call("POST", "/logistics/join", { token: driverA.token, body: { code: "NOPE0000" } });
    check("an unknown join code is refused (404)", wrongCode.status === 404, wrongCode.data);
    const joinA = await call("POST", "/logistics/join", { token: driverA.token, body: { code: companyA.data?.provider?.joinCode } });
    const joinB = await call("POST", "/logistics/join", { token: driverB.token, body: { code: companyB.data?.provider?.joinCode } });
    check("drivers join their companies with the join code", joinA.status === 200 && joinB.status === 200, [joinA.data, joinB.data]);

    const roster = await call("GET", "/logistics/drivers", { token: carrierA.token });
    check("the company sees its driver", roster.data?.drivers?.some((d) => String(d.id) === String(driverA.id)), roster.data);

    const providerIds = [companyA.data?.provider?.id, companyB.data?.provider?.id];
    for (const id of providerIds) {
      await call("PATCH", `/admin/providers/${id}`, { token: adminToken, body: { verified: true } });
    }
    const providerList = await call("GET", "/admin/providers", { token: adminToken });
    check(
      "admin verifies both companies",
      providerIds.every((id) => providerList.data?.providers?.find((p) => String(p.id) === String(id))?.verified),
      providerList.data
    );

    // ---- checkout quote --------------------------------------------------------
    console.log("\ncheckout quote");
    const quote = await call("POST", "/orders/quote", {
      token: buyer.token,
      body: { items: [{ productId, quantity: 120 }], deliveryAddress: "Indore" },
    });
    check("buyer gets a delivered-price quote", quote.status === 200, quote.data);
    check("the 100 kg tier price applies to 120 kg", quote.data?.lines?.[0]?.pricePerKg === 27, quote.data?.lines);
    check("the quote carries a road distance", quote.data?.delivery?.distanceKm > 100, quote.data?.delivery);
    const providerOptions = (quote.data?.delivery?.options || []).filter((o) => o.carrier === "provider");
    check("both verified carriers are offered as options", providerOptions.length >= 2, quote.data?.delivery?.options);
    const qc = quote.data?.charges || {};
    check(
      "grand total = goods + delivery fee",
      Math.abs(qc.grandTotal - (qc.goods + qc.deliveryFee)) < 0.005 && qc.goods === 3240,
      qc
    );
    check("buyer does not see the farmer's commission", qc.commission === undefined, qc);
    check("a liability-covered carrier is chosen", quote.data?.delivery?.chosen?.carrier === "provider", quote.data?.delivery?.chosen);

    // ---- order 1: the happy path -----------------------------------------------
    console.log("\norder 1: prepaid, carrier, inspected, confirmed");
    const place1 = await call("POST", "/orders", {
      token: buyer.token,
      body: { items: [{ productId, quantity: 120 }], deliveryAddress: "Indore", paymentMethod: "UPI" },
    });
    const order1 = place1.data?.order;
    check("buyer places a prepaid order", place1.status === 201 && !!order1?._id, place1.data);
    check("totalAmount stays the goods total", order1?.totalAmount === 3240, order1?.totalAmount);
    check("prepaid money is held in escrow", order1?.settlement?.status === "held", order1?.settlement);

    const farmerView = await call("GET", `/orders/${order1._id}`, { token: farmer.token });
    check(
      "farmer sees their commission and payout",
      farmerView.data?.charges?.commissionPct === 4 && Math.abs(farmerView.data?.charges?.payout - 3110.4) < 0.01,
      farmerView.data?.charges
    );

    await call("PATCH", `/orders/${order1._id}/status`, { token: farmer.token, body: { status: "Accepted" } });

    const offersFor = async (orderId) => {
      const [a, b] = await Promise.all([
        call("GET", "/logistics/assignments?status=offered", { token: carrierA.token }),
        call("GET", "/logistics/assignments?status=offered", { token: carrierB.token }),
      ]);
      const inA = (a.data?.assignments || []).find((x) => String(x.order?.id) === String(orderId));
      const inB = (b.data?.assignments || []).find((x) => String(x.order?.id) === String(orderId));
      if (inA) return { offer: inA, company: carrierA, driver: driverA, other: { company: carrierB, driver: driverB } };
      if (inB) return { offer: inB, company: carrierB, driver: driverB, other: { company: carrierA, driver: driverA } };
      return null;
    };

    const first = await offersFor(order1._id);
    check("accepting the order offers it to a carrier", !!first, first);
    check("an offer shows only the drop region, not the address", first && !String(first.offer.order.drop).includes("undefined") && first.offer.order.buyerName === undefined, first?.offer?.order);

    const poach = await call("PATCH", `/orders/${order1._id}/status`, {
      token: freelancer.token,
      body: { status: "In Transit", inspection: PICKUP_OK },
    });
    check("a freelancer cannot grab a job offered to a company (403)", poach.status === 403, poach.data);

    const declined = await call("POST", `/logistics/assignments/${first.offer.id}/reject`, {
      token: first.company.token,
      body: { reason: "No truck free today" },
    });
    check("the first carrier declines", declined.status === 200, declined.data);

    const second = await offersFor(order1._id);
    check("the job moves on to the other carrier", second && second.company === first.other.company, second);

    const wrongDriver = await call("POST", `/logistics/assignments/${second.offer.id}/accept`, {
      token: second.company.token,
      body: { driverId: first.driver.id },
    });
    check("a carrier cannot assign another company's driver (400)", wrongDriver.status === 400, wrongDriver.data);

    const took = await call("POST", `/logistics/assignments/${second.offer.id}/accept`, {
      token: second.company.token,
      body: { driverId: second.driver.id },
    });
    check("the second carrier accepts with its own driver", took.status === 200, took.data);
    check("the accepting carrier now sees the full address", took.data?.deliveryAddress === "Indore", took.data);

    const noInspection = await call("PATCH", `/orders/${order1._id}/status`, {
      token: second.driver.token,
      body: { status: "In Transit" },
    });
    check(
      "goods cannot leave without a pickup inspection (409)",
      noInspection.status === 409 && noInspection.data?.code === "PICKUP_INSPECTION_REQUIRED",
      noInspection.data
    );

    const collected = await call("PATCH", `/orders/${order1._id}/status`, {
      token: second.driver.token,
      body: { status: "In Transit", inspection: { ...PICKUP_OK, grade: "B", measuredKg: 119 } },
    });
    check("the driver inspects and collects in one step", collected.status === 200, collected.data);

    const delivered1 = await call("PATCH", `/orders/${order1._id}/status`, {
      token: second.driver.token,
      body: { status: "Delivered" },
    });
    check("the driver delivers", delivered1.status === 200, delivered1.data);

    const ops1 = await call("GET", `/orders/${order1._id}/operations`, { token: buyer.token });
    check("buyer is asked to confirm the delivery", ops1.data?.canConfirmDelivery === true, ops1.data);
    check("buyer sees the pickup inspection record", ops1.data?.inspection?.records?.some((r) => r.stage === "pickup" && r.grade === "B"), ops1.data?.inspection);

    const strangerOps = await call("GET", `/orders/${order1._id}/operations`, { token: freelancer.token });
    check("an uninvolved driver cannot read the operations (403)", strangerOps.status === 403, strangerOps.status);

    const confirm1 = await call("POST", `/inspections/order/${order1._id}/delivery`, {
      token: buyer.token,
      body: { condition: "good", receivedKg: 119 },
    });
    check("buyer confirms good condition", confirm1.status === 201 && confirm1.data?.result === "passed", confirm1.data);
    check("confirmation releases the escrow", confirm1.data?.settlementStatus === "released", confirm1.data);

    const again = await call("POST", `/inspections/order/${order1._id}/delivery`, {
      token: buyer.token,
      body: { condition: "damaged", notes: "Changed my mind" },
    });
    check("delivery cannot be confirmed twice (409)", again.status === 409, again.data);

    const ledger1 = await call("GET", `/admin/ledger/${order1._id}`, { token: adminToken });
    check("order 1's books close to zero", ledger1.data?.balance?.stillHeld === 0, ledger1.data?.balance);
    const farmerPayout = (ledger1.data?.rows || []).find((r) => r.type === "payout" && r.party === "farmer");
    check("farmer is paid goods minus commission", Math.abs((farmerPayout?.amount || 0) - 3110.4) < 0.01, farmerPayout);

    const farmerOps = await call("GET", `/orders/${order1._id}/operations`, { token: farmer.token });
    check(
      "farmer's ledger view shows only their own money",
      farmerOps.data?.ledger?.length > 0 && farmerOps.data.ledger.every((r) => r.party === "farmer"),
      farmerOps.data?.ledger
    );

    // ---- order 2: damaged in transit, disputed, resolved ----------------------
    console.log("\norder 2: cash on delivery, damaged in transit, admin decides");
    const place2 = await call("POST", "/orders", {
      token: buyer.token,
      body: { items: [{ productId, quantity: 150 }], deliveryAddress: "Indore", paymentMethod: "Cash on Delivery" },
    });
    const order2 = place2.data?.order;
    check("COD order waits for payment", order2?.settlement?.status === "awaiting_payment", order2?.settlement);

    await call("PATCH", `/orders/${order2._id}/status`, { token: farmer.token, body: { status: "Accepted" } });
    const offer2 = await offersFor(order2._id);
    await call("POST", `/logistics/assignments/${offer2?.offer?.id}/accept`, {
      token: offer2?.company?.token,
      body: { driverId: offer2?.driver?.id },
    });

    const badPickup = await call("POST", `/inspections/order/${order2._id}/pickup`, {
      token: offer2.driver.token,
      body: { grade: "Z" },
    });
    check("an invalid inspection is refused with reasons (400)", badPickup.status === 400 && Array.isArray(badPickup.data?.problems), badPickup.data);

    const pickup2 = await call("POST", `/inspections/order/${order2._id}/pickup`, {
      token: offer2.driver.token,
      body: { ...PICKUP_OK, measuredKg: 150 },
    });
    check("the company driver records a passing pickup inspection", pickup2.status === 201 && pickup2.data?.result === "passed", pickup2.data);

    await call("PATCH", `/orders/${order2._id}/status`, { token: offer2.driver.token, body: { status: "In Transit" } });
    await call("PATCH", `/orders/${order2._id}/status`, { token: offer2.driver.token, body: { status: "Delivered" } });

    const unexplained = await call("POST", `/inspections/order/${order2._id}/delivery`, {
      token: buyer.token,
      body: { condition: "damaged" },
    });
    check("a damage report needs a description (400)", unexplained.status === 400, unexplained.data);

    const report2 = await call("POST", `/inspections/order/${order2._id}/delivery`, {
      token: buyer.token,
      body: { condition: "damaged", receivedKg: 150, notes: "Crates crushed, most tomatoes split" },
    });
    check("buyer reports damage and payment is frozen", report2.data?.settlementStatus === "disputed", report2.data);
    check("liability points at the carrier (grade A at pickup)", report2.data?.liability === "logistics", report2.data);

    const disputes = await call("GET", "/admin/disputes", { token: adminToken });
    const dispute2 = (disputes.data?.disputes || []).find((d) => String(d.orderId) === String(order2._id));
    check("the dispute reaches the admin queue with both inspections", dispute2?.inspections?.length === 2, dispute2);

    const badResolve = await call("POST", `/admin/disputes/${order2._id}/resolve`, {
      token: adminToken,
      body: { liability: "logistics", refundPct: 150 },
    });
    check("a refund over 100% is refused (400)", badResolve.status === 400, badResolve.data);

    const resolved = await call("POST", `/admin/disputes/${order2._id}/resolve`, {
      token: adminToken,
      body: { liability: "logistics", refundPct: 100, notes: "Photos confirm crush damage" },
    });
    check("admin resolves: full refund, carrier liable", resolved.status === 200 && resolved.data?.settlementStatus === "refunded", resolved.data);
    check("the books still close after a platform advance", resolved.data?.booksClosed === true, resolved.data);
    check("the loss beyond the carrier's fee becomes a claim", resolved.data?.claimAgainstCarrier > 0, resolved.data);

    const ledger2 = await call("GET", `/admin/ledger/${order2._id}`, { token: adminToken });
    const refunded2 = (ledger2.data?.rows || []).filter((r) => r.type === "refund").reduce((s, r) => s + r.amount, 0);
    check(
      "the buyer gets back everything they paid, delivery included",
      Math.abs(refunded2 - order2.charges.grandTotal) < 0.01 && refunded2 > 150 * 27,
      { refunded2, grandTotal: order2.charges.grandTotal }
    );

    // ---- order 3: fails inspection at the farm --------------------------------
    console.log("\norder 3: rejected at the farm gate");
    const place3 = await call("POST", "/orders", {
      token: buyer.token,
      body: { items: [{ productId, quantity: 60 }], deliveryAddress: "Indore", paymentMethod: "Card" },
    });
    const order3 = place3.data?.order;
    await call("PATCH", `/orders/${order3._id}/status`, { token: farmer.token, body: { status: "Accepted" } });
    const offer3 = await offersFor(order3._id);
    await call("POST", `/logistics/assignments/${offer3?.offer?.id}/accept`, {
      token: offer3?.company?.token,
      body: { driverId: offer3?.driver?.id },
    });
    const failed3 = await call("PATCH", `/orders/${order3._id}/status`, {
      token: offer3.driver.token,
      body: {
        status: "In Transit",
        inspection: { grade: "C", checks: { freshness: false, pestFree: true }, notes: "Soft and leaking, picked days ago" },
      },
    });
    check(
      "failed pickup inspection blocks the shipment (409)",
      failed3.status === 409 && failed3.data?.code === "PICKUP_INSPECTION_FAILED",
      failed3.data
    );
    const after3 = await call("GET", `/orders/${order3._id}`, { token: buyer.token });
    check("the order is rejected", after3.data?.status === "Rejected", after3.data?.status);
    check("the prepaid buyer is refunded in full", after3.data?.settlement?.status === "refunded", after3.data?.settlement);

    const quality = await call("GET", "/inspections/farmer/me", { token: farmer.token });
    check(
      "farmer's quality record counts passes and failures",
      quality.data?.inspected === 3 && quality.data?.passRatePct === 67,
      quality.data
    );

    // ---- order 4: no carrier available -----------------------------------------
    console.log("\norder 4: falls back to independent drivers");
    for (const id of providerIds) {
      await call("PATCH", `/admin/providers/${id}`, { token: adminToken, body: { active: false } });
    }
    const place4 = await call("POST", "/orders", {
      token: buyer.token,
      body: { items: [{ productId, quantity: 20 }], deliveryAddress: "Indore" },
    });
    const order4 = place4.data?.order;
    check("with no carriers the quote uses the independent rate", order4?.charges?.quote?.carrier === "independent", order4?.charges?.quote);
    const accepted4 = await call("PATCH", `/orders/${order4._id}/status`, { token: farmer.token, body: { status: "Accepted" } });
    check("the order goes to the independent pool", accepted4.data?.order?.logistics?.mode === "independent", accepted4.data?.order?.logistics);
    check(
      "a company driver is never auto-assigned from the independent pool",
      ![String(driverA.id), String(driverB.id)].includes(String(accepted4.data?.order?.driverId)),
      accepted4.data?.order?.driverId
    );
    const cancel4 = await call("PATCH", `/orders/${order4._id}/cancel`, { token: buyer.token });
    check("cancelling an unpaid order voids its settlement", cancel4.data?.order?.settlement?.status === "voided", cancel4.data?.order?.settlement);

    // ---- wholesale ---------------------------------------------------------------
    console.log("\nwholesale accounts and invoices");
    const notYet = await call("POST", "/b2b/quote", {
      token: bizBuyer.token,
      body: { items: [{ productId, quantity: 100 }] },
    });
    check("wholesale needs a verified account (403)", notYet.status === 403, notYet.data);

    const badGst = await call("POST", "/b2b/account", { token: bizBuyer.token, body: { companyName: "Ops Foods", gstin: "123" } });
    check("an invalid GSTIN is refused (400)", badGst.status === 400, badGst.data);

    const request = await call("POST", "/b2b/account", {
      token: bizBuyer.token,
      body: { companyName: "Ops Foods Pvt Ltd", gstin: "27aapfu0939f1zv" },
    });
    check("buyer requests a business account", request.status === 201 && request.data?.business?.status === "requested", request.data);

    const stillConsumer = await call("POST", "/b2b/quote", { token: bizBuyer.token, body: { items: [{ productId, quantity: 100 }] } });
    check("a pending request grants nothing yet (403)", stillConsumer.status === 403, stillConsumer.status);

    const queue = await call("GET", "/admin/business-accounts", { token: adminToken });
    check("the request is in the admin queue", queue.data?.accounts?.some((a) => String(a.id) === String(bizBuyer.id)), queue.data);

    const approve = await call("POST", `/admin/business-accounts/${bizBuyer.id}`, {
      token: adminToken,
      body: { decision: "approve", paymentTerms: "net30", creditLimit: 10000 },
    });
    check("admin approves net-30 terms with a credit limit", approve.status === 200 && approve.data?.account?.accountType === "business", approve.data);

    const tooSmall = await call("POST", "/b2b/quote", { token: bizBuyer.token, body: { items: [{ productId, quantity: 20 }] } });
    check("wholesale lines have a minimum quantity (400)", tooSmall.status === 400, tooSmall.data);

    const bigQuote = await call("POST", "/b2b/quote", { token: bizBuyer.token, body: { items: [{ productId, quantity: 600 }] } });
    check("600 kg gets the deepest tier", bigQuote.data?.lines?.[0]?.pricePerKg === 25, bigQuote.data?.lines);
    check("the quote reports the bulk saving", bigQuote.data?.bulkSavings === 3000, bigQuote.data?.bulkSavings);
    check("the business fee tier applies", bigQuote.data?.fees?.tier === "business", bigQuote.data?.fees);
    check("over the credit limit, invoice terms are unavailable", bigQuote.data?.credit?.canUseInvoice === false, bigQuote.data?.credit);

    const overLimit = await call("POST", "/b2b/orders", {
      token: bizBuyer.token,
      body: { items: [{ productId, quantity: 600 }], paymentMethod: "Invoice" },
    });
    check("an invoice order over the credit limit is refused (402)", overLimit.status === 402, overLimit.data);

    const invoiceOrder = await call("POST", "/b2b/orders", {
      token: bizBuyer.token,
      body: { items: [{ productId, quantity: 300 }], paymentMethod: "Invoice" },
    });
    const order5 = invoiceOrder.data?.order;
    check("a wholesale order goes on net-30 invoice", invoiceOrder.status === 201 && order5?.paymentStatus === "Invoiced", invoiceOrder.data);
    check("the invoice has a number and due date", /^FL-\d{8}-[0-9A-F]{6}$/.test(order5?.invoice?.number || "") && !!order5?.invoice?.dueAt, order5?.invoice);

    const exposure = await call("POST", "/b2b/orders", {
      token: bizBuyer.token,
      body: { items: [{ productId, quantity: 100 }], paymentMethod: "Invoice" },
    });
    check("open invoices count against the credit limit (402)", exposure.status === 402, exposure.data);

    const invoices = await call("GET", "/b2b/invoices", { token: bizBuyer.token });
    check("the invoice is listed as open", invoices.data?.invoices?.[0]?.state === "open", invoices.data);

    const paid = await call("POST", `/b2b/invoices/${order5._id}/pay`, { token: bizBuyer.token });
    check("paying the invoice moves the money into escrow", paid.status === 200 && paid.data?.settlementStatus === "held", paid.data);
    const payTwice = await call("POST", `/b2b/invoices/${order5._id}/pay`, { token: bizBuyer.token });
    check("an invoice cannot be paid twice (409)", payTwice.status === 409, payTwice.data);

    // ---- partner API -------------------------------------------------------------
    console.log("\npartner API");
    const consumerKey = await call("POST", "/b2b/api-keys", { token: buyer.token, body: { name: "Mine" } });
    check("a consumer account cannot mint API keys (403)", consumerKey.status === 403, consumerKey.status);

    const readKey = await call("POST", "/b2b/api-keys", {
      token: bizBuyer.token,
      body: { name: "Catalogue sync", scopes: ["products:read", "quotes:write"], rateLimitPerMinute: 3 },
    });
    const limitedKey = readKey.data?.key;
    check("a business mints a scoped key, shown once", readKey.status === 201 && /^fl_live_[0-9a-f]{8}_[0-9a-f]{48}$/.test(limitedKey || ""), readKey.data);

    const listed = await call("GET", "/b2b/api-keys", { token: bizBuyer.token });
    check("listing keys never reveals the secret", !JSON.stringify(listed.data).includes(limitedKey), "secret leaked");

    const noKey = await call("GET", "/v1/products");
    check("the partner API needs a key (401)", noKey.status === 401 && noKey.data?.error === "invalid_api_key", noKey.data);
    const forged = await call("GET", "/v1/products", { apiKey: limitedKey.slice(0, -1) + (limitedKey.endsWith("0") ? "1" : "0") });
    check("a forged key is refused (401)", forged.status === 401, forged.data);

    const hello = await call("GET", "/v1", { apiKey: limitedKey });
    check("a key identifies its company", hello.status === 200 && hello.data?.account?.gstin === "27AAPFU0939F1ZV", hello.data);

    const catalogue = await call("GET", "/v1/products?crop=tomato&location=Bhopal", { apiKey: limitedKey });
    const ours = (catalogue.data?.data || []).find((p) => String(p.id) === String(productId));
    check("the catalogue lists the crop with its bulk tiers", ours?.bulkTiers?.length === 2, catalogue.data);
    check("rate limit headers are sent", catalogue.headers.get("x-ratelimit-limit") === "3", [...catalogue.headers.entries()]);

    const scopeDenied = await call("POST", "/v1/orders", { apiKey: limitedKey, body: { items: [{ productId, quantity: 60 }] } });
    check("a key without orders:write cannot order (403)", scopeDenied.status === 403 && scopeDenied.data?.error === "insufficient_scope", scopeDenied.data);

    const apiQuote = await call("POST", "/v1/quotes", { apiKey: limitedKey, body: { items: [{ productId, quantity: 100 }] } });
    check("a partner gets a quote", apiQuote.status === 200 && apiQuote.data?.lines?.[0]?.pricePerKg === 27, apiQuote.data);

    const throttled = await call("GET", "/v1/products", { apiKey: limitedKey });
    check("the per-minute rate limit is enforced (429)", throttled.status === 429 && !!throttled.headers.get("retry-after"), throttled.data);

    const fullKey = await call("POST", "/b2b/api-keys", { token: bizBuyer.token, body: { name: "ERP orders" } });
    const apiOrder = await call("POST", "/v1/orders", {
      apiKey: fullKey.data?.key,
      body: { items: [{ productId, quantity: 60 }], deliveryAddress: "Indore", paymentMethod: "UPI" },
    });
    check("a partner places a prepaid order through the API", apiOrder.status === 201 && apiOrder.data?.channel === "api", apiOrder.data);
    check("API responses never expose internal fee splits", apiOrder.data?.charges && apiOrder.data.charges.commission === undefined, apiOrder.data?.charges);

    const apiOrders = await call("GET", "/v1/orders", { apiKey: fullKey.data?.key });
    check("the partner lists its orders", apiOrders.data?.total >= 2, apiOrders.data?.total);

    const revoke = await call("DELETE", `/b2b/api-keys/${readKey.data?.apiKey?.id}`, { token: bizBuyer.token });
    check("the business revokes a key", revoke.status === 200, revoke.data);
    const revoked = await call("GET", "/v1", { apiKey: limitedKey });
    check("a revoked key stops working (401)", revoked.status === 401 && revoked.data?.error === "revoked_api_key", revoked.data);

    // ---- routing -----------------------------------------------------------------
    console.log("\nroad routing");
    const route = await call("POST", "/routes/optimal", { token: buyer.token, body: { from: "Bhopal", to: "Indore", weightKg: 200 } });
    check("the optimal route has distance, time and a line to draw", route.status === 200 && route.data?.distanceKm > 150 && route.data?.geometry?.length >= 2, route.data && { ...route.data, geometry: route.data.geometry?.length });
    check("the route names its source", ["osrm", "google", "haversine"].includes(route.data?.source), route.data?.source);
    check("a carrier is suggested", !!route.data?.suggestedCarrier, route.data?.suggestedCarrier);
    const lost = await call("POST", "/routes/optimal", { token: buyer.token, body: { from: "Atlantis", to: "Indore" } });
    check("an unknown place is reported, not invented (422)", lost.status === 422, lost.data);
    const anonRoute = await call("POST", "/routes/optimal", { body: { from: "Bhopal", to: "Indore" } });
    check("routing needs a login (401)", anonRoute.status === 401, anonRoute.status);

    // ---- admin overview and audit --------------------------------------------------
    console.log("\nadmin overview and audit trail");
    const overview = await call("GET", "/admin/overview", { token: adminToken });
    check("admin overview reports money and queues", overview.status === 200 && typeof overview.data?.money?.platformRevenue === "number", overview.data);

    const trail = await call("GET", `/admin/audit?entityId=${order1._id}&limit=100`, { token: adminToken });
    const actions = new Set((trail.data?.entries || []).map((e) => e.action));
    check(
      "order 1's history is fully audited",
      ["order.placed", "settlement.opened", "logistics.offered", "logistics.rejected", "logistics.accepted", "inspection.pickup", "order.status", "settlement.released"].every((a) => actions.has(a)),
      [...actions]
    );

    const AuditLog = require("./models/AuditLog");
    let immutable = false;
    try {
      await AuditLog.updateOne({ entityId: order1._id }, { $set: { action: "tampered" } });
    } catch {
      immutable = true;
    }
    check("audit entries cannot be edited", immutable);

    const pairs = await call("GET", "/admin/pairs", { token: adminToken });
    check("admin sees working farmer-buyer pairs", pairs.status === 200 && Array.isArray(pairs.data?.pairs), pairs.data);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  unexpected error: ${error.stack || error.message}`);
  } finally {
    // ---- cleanup ----------------------------------------------------------------
    try {
      if (adminToken && originalSettings) {
        const pick = (s) => ({
          fees: s.fees,
          independentRateCard: s.independentRateCard,
          inspection: s.inspection,
          escrow: s.escrow,
          logistics: s.logistics,
          b2b: s.b2b,
        });
        await call("PUT", "/admin/settings", { token: adminToken, body: pick(originalSettings) });
      }

      const Order = require("./models/Order");
      const Product = require("./models/Product");
      const users = await User.find({ email: new RegExp(`${stamp}@${DOMAIN.replace(".", "\\.")}$`) });
      const ids = users.map((u) => u._id);
      const orders = await Order.find({ buyerId: { $in: ids } }).select("_id");
      const orderIds = orders.map((o) => o._id);
      const providers = await require("./models/LogisticsProvider").find({ ownerId: { $in: ids } }).select("_id");
      const providerIdList = providers.map((p) => p._id);

      await require("./models/LedgerEntry").deleteMany({ orderId: { $in: orderIds } });
      await require("./models/Inspection").deleteMany({ orderId: { $in: orderIds } });
      await require("./models/LogisticsAssignment").deleteMany({ orderId: { $in: orderIds } });
      await require("./models/AuditLog").deleteMany({
        $or: [{ actorId: { $in: ids } }, { entityId: { $in: [...orderIds, ...ids, ...providerIdList] } }],
      });
      await require("./models/ApiKey").deleteMany({ ownerId: { $in: ids } });
      await require("./models/LogisticsProvider").deleteMany({ _id: { $in: providerIdList } });
      await Order.deleteMany({ _id: { $in: orderIds } });
      await Product.deleteMany({ farmerId: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    } catch (error) {
      console.log(`  (cleanup problem: ${error.message})`);
    }
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
