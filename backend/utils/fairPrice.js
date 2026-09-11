// The fair-deal calculator.
//
// The pitch behind FarmLink is disintermediation: in a conventional chain the
// farmer sells at the farm gate to an aggregator for well under the market
// rate, and the shopper pays well over it, with the gap absorbed by traders,
// commission agents, transport and shop margin. Selling direct does not create
// value out of nothing - it recovers that gap, and there is enough of it to
// pay the farmer more AND charge the buyer less at the same time.
//
// This module quantifies both halves of that, and says plainly where each
// number comes from.
//
// ===========================================================================
// HONESTY ABOUT THE INPUTS - please read before trusting these figures
// ===========================================================================
// * The market reference is REAL: the median of what farmers are actually
//   listing that crop for on FarmLink right now. Its sample size travels with
//   it so a thin market can be flagged as such.
//
// * The farm-gate and retail figures are MODELLED, not measured. FarmLink has
//   no feed of mandi rates or shop prices, so they are the reference scaled by
//   the documented multipliers below - they describe a typical chain, not the
//   shop on your corner today. Everything derived from them is an estimate and
//   is labelled that way all the way to the screen.
//
// * Quality is never the lever. None of this assumes a lower grade, a smaller
//   pack or an older crop. The saving comes from removing steps in the chain,
//   and removing steps also means fewer days between harvest and kitchen.
// ===========================================================================

// Share of the prevailing market price a farmer typically receives selling at
// the farm gate to a trader. Widely reported in Indian agricultural marketing
// studies to sit in the 55-70% range for perishable vegetables; 0.65 is a
// deliberately conservative mid-point (conservative = understates the gain we
// claim for the farmer).
const FARM_GATE_SHARE = Number(process.env.FARM_GATE_SHARE || 0.65);

// What a shopper typically pays relative to the same market price, once
// transport, wastage, commission and shop margin are stacked on.
const RETAIL_MULTIPLE = Number(process.env.RETAIL_MULTIPLE || 1.45);

// How the recovered gap is split when we suggest a price. 0.5 = evenly.
const DEFAULT_SPLIT = Number(process.env.FAIR_SPLIT || 0.5);

// The buyer must keep a saving worth noticing, or "buy direct" is just a
// worse shop. This is the floor we protect when maximising farmer take.
const MIN_BUYER_SAVING_SHARE = 0.15;

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Work out what a given asking price means for both sides.
 *
 * @param {object} input
 *   referencePricePerKg  the observed market reference (required, > 0)
 *   pricePerKg           the asking price being evaluated (optional)
 *   quantityKg           lot size, to turn per-kg figures into totals
 *   split                how to divide the recovered gap (0..1)
 * @returns {object|null} null when there is no usable reference
 */
function computeFairDeal({
  referencePricePerKg,
  pricePerKg = null,
  quantityKg = null,
  split = DEFAULT_SPLIT,
} = {}) {
  const reference = Number(referencePricePerKg);
  if (!Number.isFinite(reference) || reference <= 0) return null;

  const farmGate = reference * FARM_GATE_SHARE;
  const retail = reference * RETAIL_MULTIPLE;
  const gap = retail - farmGate; // the whole intermediary margin, per kg

  const clampedSplit = Math.min(1, Math.max(0, Number(split) || 0));
  const fairPrice = farmGate + clampedSplit * gap;

  // The most the farmer can charge while the buyer still saves meaningfully.
  const maxFarmerPrice = retail - MIN_BUYER_SAVING_SHARE * gap;

  const result = {
    reference: round2(reference),
    farmGatePrice: round2(farmGate),
    retailPrice: round2(retail),
    recoverableGapPerKg: round2(gap),
    suggestedPrice: round2(fairPrice),
    maxFarmerPrice: round2(maxFarmerPrice),
    fairBand: { min: round2(farmGate), max: round2(retail) },
    assumptions: {
      farmGateShare: FARM_GATE_SHARE,
      retailMultiple: RETAIL_MULTIPLE,
      split: clampedSplit,
      note:
        "Farm-gate and retail prices are modelled from the market reference " +
        "using typical supply-chain margins. They are estimates of a " +
        "conventional chain, not surveyed shop prices.",
    },
  };

  if (pricePerKg === null || !Number.isFinite(Number(pricePerKg))) {
    return result;
  }

  const price = Number(pricePerKg);
  const farmerGain = price - farmGate;
  const buyerSaving = retail - price;

  result.askingPrice = round2(price);
  result.farmerGainPerKg = round2(farmerGain);
  result.buyerSavingPerKg = round2(buyerSaving);
  result.farmerGainPct = round2((farmerGain / farmGate) * 100);
  result.buyerSavingPct = round2((buyerSaving / retail) * 100);

  // Who is actually better off at this price?
  result.bothWin = farmerGain > 0 && buyerSaving > 0;
  result.verdict = verdictFor(price, farmGate, retail);

  if (Number.isFinite(Number(quantityKg)) && Number(quantityKg) > 0) {
    const qty = Number(quantityKg);
    result.quantityKg = qty;
    result.farmerGainTotal = round2(farmerGain * qty);
    result.buyerSavingTotal = round2(buyerSaving * qty);
  }

  return result;
}

function verdictFor(price, farmGate, retail) {
  if (price < farmGate) {
    return {
      code: "underpriced",
      forFarmer:
        "This is below what a trader would have paid at the farm gate - you are " +
        "losing money by selling direct at this price.",
      forBuyer: "An unusually low price for this crop.",
    };
  }
  if (price > retail) {
    return {
      code: "above-retail",
      forFarmer:
        "This is above what a shop would typically charge, so buyers have no " +
        "reason to buy direct.",
      forBuyer: "This costs more than a typical shop price for this crop.",
    };
  }
  return {
    code: "fair",
    forFarmer: "You earn more than a trader would pay, and the buyer still saves.",
    forBuyer: "You pay less than a typical shop price, and the farmer earns more.",
  };
}

/**
 * The quality story, stated explicitly so nobody reads the saving as a
 * discount on grade.
 *
 * @param {number|null} transitKm  farm-to-door distance, when known
 */
function qualityNote(transitKm = null) {
  const points = [
    "The saving comes from removing trader and shop margin, not from a lower grade.",
    "You buy the same crop the farmer listed, at the quantity you chose.",
  ];

  if (Number.isFinite(Number(transitKm)) && Number(transitKm) > 0) {
    // The planner's own 28km/h assumption, so this cannot drift from the ETA
    // shown on the tracking map.
    const hours = Number(transitKm) / 28;
    points.push(
      hours <= 24
        ? `One hop from farm to door - roughly ${Math.max(1, Math.round(hours))} hour(s) in transit, against the several days a conventional chain adds.`
        : "Fewer handling steps than a conventional chain, so less time between harvest and delivery."
    );
  } else {
    points.push(
      "A direct hop from farm to door means fewer handling steps and less time in storage than a conventional chain."
    );
  }

  return points;
}

module.exports = {
  computeFairDeal,
  qualityNote,
  FARM_GATE_SHARE,
  RETAIL_MULTIPLE,
  DEFAULT_SPLIT,
  MIN_BUYER_SAVING_SHARE,
};
