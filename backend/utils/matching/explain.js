// Step 5 of the matching pipeline: say why, in words a farmer or a shopkeeper
// would actually use.
//
// Two lists come back from every match:
//   reasons     - what makes this a good pairing
//   limitations - what we could not check, or what works against it
//
// The limitations are not decoration. If the ML service was down, or we could
// not place a city on the map, or the buyer is brand new, the card says so
// rather than quietly presenting a neutral score as if it were a finding.

const KG = (n) => `${Math.round(Number(n) || 0).toLocaleString("en-IN")} kg`;
const RS = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * @param {object} scored  the output of scoreMatch()
 * @param {object} ctx     { cropName, counterpartyName, direction, productLocation,
 *                           counterpartyLocation, profile, prefs }
 */
function explain(scored, ctx = {}) {
  const { details, scoreBreakdown } = scored;
  const reasons = [];
  const limitations = [];

  const who = ctx.direction === "buyers" ? "This buyer" : "This farmer";
  const crop = ctx.cropName || "this crop";

  // ---- crop -------------------------------------------------------------
  const cropPart = details.crop;
  if (cropPart.basis === "stated-preference") {
    reasons.push(`${crop} is on their list of preferred crops.`);
  } else if (cropPart.basis === "purchase-history") {
    const pct = Math.round((cropPart.share || 0) * 100);
    reasons.push(
      `${who.toLowerCase() === "this buyer" ? "They have" : "They have"} bought ${crop} before — about ${pct}% of their order lines.`
    );
  } else if (cropPart.basis === "related-preference" || cropPart.basis === "related-history") {
    reasons.push(`They deal in crops similar to ${crop}.`);
  } else if (cropPart.basis === "outside-stated-preference") {
    limitations.push(`${crop} is not among the crops they said they want.`);
  } else if (cropPart.basis === "new-crop-for-this-buyer") {
    limitations.push(`They have never ordered ${crop} before.`);
  } else if (cropPart.basis === "no-data") {
    limitations.push("No stated crop preferences and no order history yet — scored neutrally.");
  }

  // ---- distance ---------------------------------------------------------
  const distancePart = details.distance;
  if (distancePart.basis === "coordinates") {
    const km = distancePart.km;
    if (km <= 30) reasons.push(`Very close by — about ${km} km away.`);
    else if (km <= 120) reasons.push(`A short haul — about ${km} km away.`);
    else if (km <= 350) reasons.push(`Reachable — about ${km} km away.`);
    else limitations.push(`A long way off — about ${km} km, so transport will cost more.`);
  } else if (distancePart.basis === "same-location-name") {
    reasons.push(`Both of you are listed in ${ctx.productLocation || "the same place"}.`);
  } else if (distancePart.basis === "preferred-location") {
    reasons.push("The crop is in one of their preferred locations.");
  } else {
    limitations.push(
      "We could not place one of the locations on the map, so distance was scored neutrally."
    );
  }

  // ---- price ------------------------------------------------------------
  const pricePart = details.price;
  if (pricePart.basis === "within-budget") {
    reasons.push("The asking price sits inside their stated budget.");
  } else if (pricePart.basis === "below-stated-minimum") {
    reasons.push(`The price is below the ${RS(pricePart.min)}/kg floor they set — cheap for them.`);
  } else if (pricePart.basis === "above-budget") {
    limitations.push(
      `The price is about ${pricePart.overPct}% above their ${RS(pricePart.max)}/kg ceiling.`
    );
  } else if (pricePart.basis === "cheaper-than-usual") {
    reasons.push(`Cheaper than the ${RS(pricePart.typical)}/kg they usually pay.`);
  } else if (pricePart.basis === "around-usual-price") {
    reasons.push(`In line with the ${RS(pricePart.typical)}/kg they usually pay.`);
  } else if (pricePart.basis === "above-usual-price") {
    limitations.push(`Dearer than the ${RS(pricePart.typical)}/kg they usually pay.`);
  } else {
    limitations.push("No budget set and nothing bought yet, so price fit is a neutral guess.");
  }

  // ---- quantity ---------------------------------------------------------
  const quantityPart = details.quantity;
  if (quantityPart.basis === "covers-requirement") {
    reasons.push(`The ${KG(quantityPart.available)} available covers what they typically take.`);
  } else if (quantityPart.basis === "partial-requirement") {
    limitations.push(
      `Only ${KG(quantityPart.available)} available — about ${quantityPart.coveragePct}% of their usual ${KG(quantityPart.target)}.`
    );
  } else if (quantityPart.basis === "below-minimum-lot") {
    limitations.push(
      `${KG(quantityPart.available)} is under the ${KG(quantityPart.minWanted)} minimum lot they accept.`
    );
  } else if (quantityPart.basis === "out-of-stock") {
    limitations.push("This crop is currently out of stock.");
  } else {
    limitations.push("No usual order size on record, so quantity fit is a neutral guess.");
  }

  // ---- demand -----------------------------------------------------------
  const demandPart = details.demand;
  if (demandPart.basis === "forecast") {
    const trend = demandPart.trendPct;
    const direction = trend > 2 ? "rising" : trend < -2 ? "easing" : "steady";
    reasons.push(`Forecast demand for ${crop} here is ${demandPart.level.toLowerCase()} and ${direction}.`);
  } else if (demandPart.basis === "forecast-unavailable") {
    limitations.push("The demand forecasting service was unreachable — demand scored neutrally.");
  } else {
    limitations.push(`No demand forecast covers ${crop} in this area yet.`);
  }

  // ---- reliability ------------------------------------------------------
  const reliabilityPart = details.reliability;
  if (reliabilityPart.basis === "track-record") {
    if (reliabilityPart.ratePct >= 80) {
      reasons.push(
        `Dependable record — ${reliabilityPart.completed} of ${reliabilityPart.completed + reliabilityPart.broken} finished orders completed.`
      );
    } else {
      limitations.push(
        `Mixed record — ${reliabilityPart.broken} of ${reliabilityPart.completed + reliabilityPart.broken} finished orders fell through.`
      );
    }
    if (reliabilityPart.qualityPassPct !== null && reliabilityPart.qualityPassPct !== undefined) {
      const line = `${reliabilityPart.qualityPassPct}% of ${reliabilityPart.inspected} inspected pickups passed quality checks.`;
      if (reliabilityPart.qualityPassPct >= 80) reasons.push(line);
      else limitations.push(line);
    }
  } else if (reliabilityPart.basis === "orders-in-flight") {
    limitations.push("Orders placed but none completed yet, so there is no track record to judge.");
  } else {
    limitations.push("New to FarmLink — no track record yet, so this was scored neutrally.");
  }

  // Keep the cards readable.
  return {
    reasons: reasons.slice(0, 5),
    limitations: limitations.slice(0, 5),
    summary: summarise(scored, scoreBreakdown),
  };
}

// One line a person can read at a glance: the strongest and weakest pillars.
function summarise(scored, breakdown) {
  const LABEL = {
    crop: "crop fit",
    distance: "distance",
    price: "price",
    quantity: "quantity",
    demand: "demand outlook",
    reliability: "track record",
  };

  const ranked = Object.entries(breakdown)
    .map(([key, part]) => ({ key, pct: part.max ? part.score / part.max : 0 }))
    .sort((a, b) => b.pct - a.pct);

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  if (!best) return `${scored.matchQuality} match.`;
  if (worst && worst.pct < 0.5) {
    return `${scored.matchQuality} match — strongest on ${LABEL[best.key]}, weakest on ${LABEL[worst.key]}.`;
  }
  return `${scored.matchQuality} match — strongest on ${LABEL[best.key]}.`;
}

module.exports = { explain };
