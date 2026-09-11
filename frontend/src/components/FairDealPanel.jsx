import { useEffect, useState } from "react";
import { pricing } from "../lib/api";
import { currency } from "../lib/format";

/**
 * "Why this is a good deal" — the same arithmetic shown from whichever side
 * you are on.
 *
 *   audience="farmer"  what you earn over a farm-gate sale to a trader
 *   audience="buyer"   what you save against a typical shop price
 *
 * Renders nothing at all when the backend has too few prices for that crop to
 * make an honest comparison: a made-up baseline would be worse than silence.
 */
export default function FairDealPanel({
  cropName,
  pricePerKg,
  quantityKg = null,
  location = null,
  buyerLocation = null,
  audience = "buyer",
  compact = false,
}) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | unavailable

  useEffect(() => {
    let alive = true;

    (async () => {
      // Bail inside the async body rather than synchronously in the effect,
      // so a missing crop or price never triggers an extra render pass.
      if (!cropName || !pricePerKg) {
        if (alive) setState("unavailable");
        return;
      }

      try {
        const result = await pricing.fairDeal({
          cropName,
          pricePerKg: Number(pricePerKg),
          quantityKg: quantityKg ? Number(quantityKg) : undefined,
          location,
          buyerLocation,
        });
        if (!alive) return;
        setData(result);
        setState(result?.deal ? "ready" : "unavailable");
      } catch {
        // 404 = not enough price history. Nothing to apologise for, just no
        // comparison to draw.
        if (alive) setState("unavailable");
      }
    })();

    return () => {
      alive = false;
    };
  }, [cropName, pricePerKg, quantityKg, location, buyerLocation]);

  if (state !== "ready" || !data?.deal) return null;

  const { deal, reference, quality, confidence } = data;
  const forFarmer = audience === "farmer";

  const headline = forFarmer ? deal.farmerGainPerKg : deal.buyerSavingPerKg;
  const headlineTotal = forFarmer ? deal.farmerGainTotal : deal.buyerSavingTotal;
  const comparedWith = forFarmer ? deal.farmGatePrice : deal.retailPrice;

  // A negative number is not a "deal" — say what is actually happening.
  const positive = headline > 0;

  return (
    <div
      className={`rounded-2xl border p-4 ${
        positive
          ? "border-emerald-200 bg-emerald-50"
          : "border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-900">
          {forFarmer ? "💰 What you earn" : "🏷️ What you save"}
        </h4>
        {confidence === "low" && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            few prices to compare
          </span>
        )}
      </div>

      {positive ? (
        <p className="mt-2 text-sm text-slate-700">
          {forFarmer ? (
            <>
              At {currency(deal.askingPrice)}/kg you earn{" "}
              <strong className="text-emerald-700">
                {currency(deal.farmerGainPerKg)}/kg more
              </strong>{" "}
              than the {currency(comparedWith)}/kg a trader would typically pay at
              the farm gate — about {deal.farmerGainPct}% more.
            </>
          ) : (
            <>
              You pay {currency(deal.askingPrice)}/kg and save{" "}
              <strong className="text-emerald-700">
                {currency(deal.buyerSavingPerKg)}/kg
              </strong>{" "}
              against the {currency(comparedWith)}/kg a shop would typically
              charge — about {deal.buyerSavingPct}% off.
            </>
          )}
        </p>
      ) : (
        <p className="mt-2 text-sm text-amber-900">
          {forFarmer ? deal.verdict?.forFarmer : deal.verdict?.forBuyer}
        </p>
      )}

      {headlineTotal != null && positive && (
        <p className="mt-2 text-lg font-bold text-emerald-700">
          {currency(headlineTotal)}{" "}
          <span className="text-xs font-normal text-slate-500">
            on {deal.quantityKg} kg
          </span>
        </p>
      )}

      {/* The chain, laid out so the numbers are checkable rather than asserted */}
      {!compact && (
        <div className="mt-4 space-y-1.5">
          {[
            { label: "Trader pays the farmer", value: deal.farmGatePrice, tone: "text-slate-500" },
            { label: "This listing", value: deal.askingPrice, tone: "font-bold text-emerald-700" },
            { label: "Typical shop price", value: deal.retailPrice, tone: "text-slate-500" },
          ].map((row) => {
            const pct = deal.retailPrice ? (row.value / deal.retailPrice) * 100 : 0;
            return (
              <div key={row.label}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-slate-600">{row.label}</span>
                  <span className={`tabular-nums ${row.tone}`}>
                    {currency(row.value)}/kg
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white">
                  <div
                    className={`h-full rounded-full ${
                      row.label === "This listing" ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                    style={{ width: `${Math.max(3, Math.min(100, pct))}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!compact && quality?.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-emerald-200/60 pt-3">
          {quality.map((point) => (
            <li key={point} className="flex gap-2 text-[11px] leading-relaxed text-slate-600">
              <span className="shrink-0 text-emerald-600">✓</span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
        Market reference: {currency(reference.pricePerKg)}/kg, the median of{" "}
        {reference.sampleSize} FarmLink{" "}
        {reference.basis === "past-orders" ? "past orders" : "listings"} for this
        crop. Farm-gate and shop prices are estimates of a typical supply chain,
        not surveyed shop prices.
      </p>
    </div>
  );
}
