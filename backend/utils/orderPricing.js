const mongoose = require("mongoose");
const Product = require("../models/Product");
const { quoteDelivery } = require("./logistics");
const { computeCharges, chargesBalance, rateCardFee } = require("./fees");
const { getSettings, tierFor } = require("./settings");

/**
 * Turn a cart into a priced, quoted order - the one place that does it.
 *
 * Used by the ordinary checkout, the checkout preview, wholesale quotes and
 * orders, and the partner API, so every channel prices identically:
 *
 *   - line prices come from the database, never the request, with any bulk
 *     tier the farmer has set applied for the quantity bought
 *   - the delivery fee is quoted on real road distance for the whole run
 *   - fees come from the buyer's tier in the current platform settings
 */

const httpError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

/**
 * @param {object} input
 *   items            [{ productId, quantity }]
 *   buyer            the buying User document
 *   deliveryAddress  where it is going
 *   minLineKg        optional minimum quantity per line (wholesale)
 * @returns {Promise<{ lines, stockUpdates, quote, charges }>}
 */
async function priceCart({ items, buyer, deliveryAddress, minLineKg = 0 }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, "Your cart is empty.");
  }
  if (items.length > 50) {
    throw httpError(400, "An order can contain at most 50 lines.");
  }

  const ids = items.map((item) => item.productId);
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw httpError(400, "Invalid product in cart.");
  }

  // One query for every product in the cart.
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const stockUpdates = [];
  let needsRefrigeration = false;

  // The same product twice in one cart is merged, so stock checks are honest.
  const merged = new Map();
  for (const item of items) {
    const key = String(item.productId);
    merged.set(key, (merged.get(key) || 0) + Number(item.quantity));
  }

  for (const [productId, quantity] of merged) {
    const product = byId.get(productId);

    if (!product) {
      throw httpError(404, "A product in your cart is no longer available.");
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw httpError(400, `Choose how many kg of ${product.cropName} you want.`);
    }
    if (minLineKg > 0 && quantity < minLineKg) {
      throw httpError(
        400,
        `Wholesale lines start at ${minLineKg} kg - ${product.cropName} has ${quantity} kg.`
      );
    }
    if (quantity > product.quantity) {
      throw httpError(
        409,
        `Only ${product.quantity} ${product.unit} of ${product.cropName} left in stock.`
      );
    }

    const pricePerKg = product.priceFor(quantity);

    lines.push({
      productId: product._id,
      cropName: product.cropName,
      farmerId: product.farmerId,
      farmerName: product.farmerName,
      location: product.location,
      quantity,
      pricePerKg,
      totalPrice: Math.round(quantity * pricePerKg * 100) / 100,
      // Not stored on the order line; reported back so the buyer sees it.
      listPricePerKg: product.pricePerKg,
      bulkTierApplied: pricePerKg < product.pricePerKg,
    });

    stockUpdates.push({ id: product._id, quantity });
    if (product.needsRefrigeration) needsRefrigeration = true;
  }

  const settings = await getSettings();
  const tier = tierFor(buyer);
  const fees = settings.fees[tier];

  const dropPlace = deliveryAddress || buyer.location || "";

  const quote = await quoteDelivery({
    lines,
    dropPlace,
    needsRefrigeration,
    coordinates: {
      pickup: byId.get(String(lines[0].productId))?.coordinates,
      drop: buyer.coordinates,
    },
  });

  // When a place cannot be located there is no honest distance. The delivery
  // is priced at the minimum fee and the quote says it is approximate, rather
  // than blocking the order or inventing a distance.
  const best = quote?.best || {
    carrier: "independent",
    providerId: null,
    providerName: "FarmLink delivery partner",
    providerFee: rateCardFee(settings.independentRateCard, 0, 0),
  };

  const charges = computeCharges({
    lines,
    providerFee: best.providerFee,
    commissionPct: fees.commissionPct,
    logisticsMarkupPct: fees.logisticsMarkupPct,
    feeTier: tier,
  });

  if (!chargesBalance(charges)) {
    // Arithmetic guarantees this never happens; if it ever does, stop.
    throw httpError(500, "Order pricing did not balance. Please try again.");
  }

  charges.quote = {
    distanceKm: quote?.route.distanceKm ?? null,
    durationMin: quote?.route.durationMin ?? null,
    weightKg: lines.reduce((t, l) => t + l.quantity, 0),
    routeSource: quote?.route.source || "unlocated",
    approximate: quote ? quote.route.approximate : true,
    needsRefrigeration,
    carrier: best.carrier,
    providerId: best.providerId || undefined,
    providerName: best.providerName,
  };

  return {
    lines,
    stockUpdates,
    quote,
    charges,
    fees: { tier, ...fees },
  };
}

/** The line shape an Order stores (drops the preview-only fields). */
const storedLines = (lines) =>
  lines.map(({ listPricePerKg, bulkTierApplied, ...line }) => line);

/** Strip the internal paise/per-farmer detail before storing on the order. */
function storedCharges(charges) {
  const { farmers, paise, ...rest } = charges;
  return rest;
}

module.exports = { priceCart, storedLines, storedCharges };
