import { useState } from "react";

/**
 * "Why this price?" — the farmer-facing view of the SHAP explanation that
 * POST /predict-price returns alongside `recommended_price`.
 *
 * The explanation block is optional: if the ML service could not produce one
 * (SHAP missing, explainer failed) it arrives as `null` and this component
 * renders nothing, so the price on its own still shows.
 *
 * No SHAP jargon reaches the screen — each row is a plain sentence plus a bar
 * whose length is that factor's share of the largest influence, drawn to the
 * right for upward pressure on the price and to the left for downward.
 */

const MAX_ROWS = 5; // never overwhelm the farmer with every model feature
const MIN_ROWS = 3;

const rupees = (value) => `₹${Math.abs(value).toFixed(1)}`;

export default function PriceExplanation({ explanation, className = "" }) {
  const [showInfo, setShowInfo] = useState(false);

  const all = explanation?.features;
  if (!Array.isArray(all) || all.length === 0) return null;

  // Show the factors that actually moved the prediction, but always keep at
  // least MIN_ROWS so the farmer sees a complete-looking picture.
  const meaningful = all.filter((f) => f.direction !== "neutral");
  const rows = (meaningful.length >= MIN_ROWS ? meaningful : all).slice(0, MAX_ROWS);

  const maxImpact = Math.max(...rows.map((f) => Math.abs(f.impact)), 0.01);

  return (
    <div className={`rounded-2xl border border-brand-200 bg-white p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-ink">Why this price?</h3>
          <button
            type="button"
            onClick={() => setShowInfo((open) => !open)}
            aria-expanded={showInfo}
            aria-label="How these factors are calculated"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-line-strong text-[11px] font-bold text-ink-soft transition hover:border-emerald-400 hover:text-brand-700"
          >
            i
          </button>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-700">
          ✨ Powered by Explainable AI
        </span>
      </div>

      {showInfo && (
        <p className="mt-3 rounded-xl bg-canvas p-3 text-xs leading-relaxed text-ink-soft">
          The model starts from an average price of{" "}
          <strong>₹{Number(explanation.base_value).toFixed(2)}/kg</strong> across
          everything it was trained on, then adjusts up or down for your crop,
          location, quantity, demand and market price. The bars below show how
          much each factor contributed to that adjustment. They describe how the
          model reached its number — not a guarantee of what the market will do.
        </p>
      )}

      <p className="mt-3 text-xs text-ink-soft">
        Starting from an average of ₹{Number(explanation.base_value).toFixed(2)}/kg,
        these factors shaped the recommendation:
      </p>

      <ul className="mt-4 space-y-3">
        {rows.map((factor) => {
          const up = factor.impact > 0;
          const width = Math.max(4, (Math.abs(factor.impact) / maxImpact) * 50);

          return (
            <li key={factor.feature}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">
                  {factor.label}
                  <span className="ml-1.5 font-normal text-ink-faint">
                    {factor.value}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-sm font-bold tabular-nums ${
                    up ? "text-brand-700" : "text-rose-500"
                  }`}
                >
                  {up ? "+" : "−"}
                  {rupees(factor.impact)}
                </span>
              </div>

              {/* diverging bar: centre line = no effect, right = upward */}
              <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-canvas">
                <div className="flex w-1/2 justify-end">
                  {!up && (
                    <div
                      className="h-full rounded-l-full bg-rose-400"
                      style={{ width: `${width * 2}%` }}
                    />
                  )}
                </div>
                <div className="w-px bg-line-strong" />
                <div className="flex w-1/2 justify-start">
                  {up && (
                    <div
                      className="h-full rounded-r-full bg-brand-500"
                      style={{ width: `${width * 2}%` }}
                    />
                  )}
                </div>
              </div>

              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                {up ? "🟢" : "🔴"} {factor.statement}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
        These factors show how the AI model arrived at its number. They explain
        the model's reasoning, not real-world cause and effect.
      </p>
    </div>
  );
}
