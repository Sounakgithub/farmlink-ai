// Platform-wide view of which farmer-buyer relationships actually work.
//
// The per-user matching endpoints answer "who should I trade with next?".
// This answers the operator's question: "which pairings already deliver, and
// how good is the produce that moves between them?". It is built purely from
// completed orders and inspection results - no estimates.

const Order = require("../../models/Order");
const Inspection = require("../../models/Inspection");

const MAX_LIMIT = 100;

async function topPairs({ limit } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), MAX_LIMIT);

  const rows = await Order.aggregate([
    { $match: { status: "Delivered" } },
    { $unwind: "$products" },
    {
      $group: {
        _id: { farmerId: "$products.farmerId", buyerId: "$buyerId" },
        farmerName: { $first: "$products.farmerName" },
        buyerName: { $first: "$buyerName" },
        orders: { $addToSet: "$_id" },
        kg: { $sum: "$products.quantity" },
        value: { $sum: "$products.totalPrice" },
        crops: { $addToSet: "$products.cropName" },
        lastOrderAt: { $max: "$createdAt" },
      },
    },
    { $addFields: { orderCount: { $size: "$orders" } } },
    { $sort: { orderCount: -1, value: -1 } },
    { $limit: take },
  ]);

  if (!rows.length) return { pairs: [], generatedAt: new Date().toISOString() };

  // Quality: pickup inspections on the orders each pair shared, one query.
  const orderIds = rows.flatMap((r) => r.orders);
  const inspections = await Inspection.find({ orderId: { $in: orderIds } })
    .select("orderId stage result farmerIds")
    .lean();

  const byOrder = new Map();
  for (const inspection of inspections) {
    const key = String(inspection.orderId);
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(inspection);
  }

  const pairs = rows.map((row) => {
    let inspected = 0;
    let passed = 0;
    let disputes = 0;
    for (const orderId of row.orders) {
      for (const inspection of byOrder.get(String(orderId)) || []) {
        if (inspection.stage === "pickup") {
          inspected += 1;
          if (inspection.result === "passed") passed += 1;
        } else if (inspection.result !== "passed") {
          disputes += 1;
        }
      }
    }

    return {
      farmer: { id: row._id.farmerId, name: row.farmerName },
      buyer: { id: row._id.buyerId, name: row.buyerName },
      completedOrders: row.orderCount,
      kgTraded: Math.round(row.kg),
      valueTraded: Math.round(row.value),
      crops: row.crops.sort(),
      lastOrderAt: row.lastOrderAt,
      quality: {
        pickupInspections: inspected,
        passRatePct: inspected ? Math.round((passed / inspected) * 100) : null,
        deliveryDisputes: disputes,
      },
    };
  });

  return { pairs, generatedAt: new Date().toISOString() };
}

module.exports = { topPairs };
