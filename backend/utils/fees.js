/**
 * What an order costs and where each rupee goes.
 *
 * The model is deliberately simple and fully visible to both sides:
 *
 *   buyer pays     goods  +  delivery fee
 *   delivery fee = carrier's rate  +  logistics markup %
 *   farmer gets    goods  -  commission %
 *   carrier gets   its rate
 *   platform keeps commission  +  markup
 *
 * All arithmetic happens in integer paise. Rounding each share independently
 * in rupees can create or lose a paisa; in paise the parts are constructed to
 * sum back to the grand total exactly, and the tests assert that they do.
 */

const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
const fromPaise = (paise) => Math.round(paise) / 100;

/**
 * A carrier's charge for a job, from its rate card.
 * Rounded to the whole rupee - nobody quotes a delivery to the paisa.
 */
function rateCardFee(rateCard, distanceKm, weightKg) {
  const card = rateCard || {};
  const raw =
    (Number(card.baseFee) || 0) +
    (Number(card.perKm) || 0) * Math.max(0, Number(distanceKm) || 0) +
    (Number(card.perKg) || 0) * Math.max(0, Number(weightKg) || 0);
  return Math.round(Math.max(Number(card.minFee) || 0, raw));
}

/**
 * Price an order.
 *
 * @param {object} input
 *   lines               [{ farmerId, totalPrice }]  goods, in rupees
 *   providerFee         what the carrier is paid, in rupees
 *   commissionPct       taken from goods
 *   logisticsMarkupPct  added to the carrier's rate
 *   feeTier             "consumer" | "business" (recorded, not used in maths)
 */
function computeCharges({
  lines = [],
  providerFee = 0,
  commissionPct = 0,
  logisticsMarkupPct = 0,
  feeTier = "consumer",
}) {
  const commissionRate = Math.max(0, Number(commissionPct) || 0) / 100;
  const markupRate = Math.max(0, Number(logisticsMarkupPct) || 0) / 100;

  // ---- goods, split per farmer --------------------------------------------
  const perFarmerPaise = new Map();
  for (const line of lines) {
    const key = String(line.farmerId);
    perFarmerPaise.set(key, (perFarmerPaise.get(key) || 0) + toPaise(line.totalPrice));
  }

  let goodsP = 0;
  let commissionP = 0;
  let farmerPayoutP = 0;
  const farmers = [];

  for (const [farmerId, farmerGoodsP] of perFarmerPaise) {
    const farmerCommissionP = Math.round(farmerGoodsP * commissionRate);
    const payoutP = farmerGoodsP - farmerCommissionP;
    goodsP += farmerGoodsP;
    commissionP += farmerCommissionP;
    farmerPayoutP += payoutP;
    farmers.push({
      farmerId,
      goods: fromPaise(farmerGoodsP),
      commission: fromPaise(farmerCommissionP),
      payout: fromPaise(payoutP),
      goodsPaise: farmerGoodsP,
      commissionPaise: farmerCommissionP,
      payoutPaise: payoutP,
    });
  }

  // ---- delivery -------------------------------------------------------------
  const providerFeeP = toPaise(providerFee);
  const markupP = Math.round(providerFeeP * markupRate);
  const deliveryFeeP = providerFeeP + markupP;

  const grandTotalP = goodsP + deliveryFeeP;
  const platformRevenueP = commissionP + markupP;

  return {
    goods: fromPaise(goodsP),
    deliveryFee: fromPaise(deliveryFeeP),
    grandTotal: fromPaise(grandTotalP),

    feeTier,
    commissionPct: Number(commissionPct) || 0,
    logisticsMarkupPct: Number(logisticsMarkupPct) || 0,

    commission: fromPaise(commissionP),
    logisticsMarkup: fromPaise(markupP),
    farmerPayout: fromPaise(farmerPayoutP),
    logisticsPayout: fromPaise(providerFeeP),
    platformRevenue: fromPaise(platformRevenueP),

    farmers,

    // The exact integers, for the ledger.
    paise: {
      goods: goodsP,
      deliveryFee: deliveryFeeP,
      grandTotal: grandTotalP,
      commission: commissionP,
      logisticsMarkup: markupP,
      farmerPayout: farmerPayoutP,
      logisticsPayout: providerFeeP,
      platformRevenue: platformRevenueP,
    },
  };
}

/** True when the split sums back to what the buyer paid, to the paisa. */
function chargesBalance(charges) {
  const p = charges.paise;
  return p.farmerPayout + p.logisticsPayout + p.platformRevenue === p.grandTotal;
}

module.exports = { computeCharges, chargesBalance, rateCardFee, toPaise, fromPaise };
