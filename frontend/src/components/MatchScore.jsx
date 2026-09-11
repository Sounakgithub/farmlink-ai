import { Badge, Modal } from "./ui";

/**
 * Shared presentation for an AI match score.
 *
 * MatchScoreBadge   - the headline number + quality tier
 * MatchBreakdown    - the six weighted pillars as bars
 * MatchDetailsModal - the full "why this match?" view
 *
 * All three read the exact shape the backend returns, so nothing is
 * recalculated on the client and the bars can never disagree with the score.
 */

const QUALITY_STYLE = {
  Excellent: "bg-emerald-100 text-emerald-700",
  Strong: "bg-green-100 text-green-700",
  Good: "bg-blue-100 text-blue-700",
  Possible: "bg-amber-100 text-amber-700",
  Weak: "bg-slate-200 text-slate-600",
};

const RING_COLOR = {
  Excellent: "text-emerald-500",
  Strong: "text-green-500",
  Good: "text-blue-500",
  Possible: "text-amber-500",
  Weak: "text-slate-400",
};

const PILLAR_LABEL = {
  crop: "Crop fit",
  distance: "Distance",
  price: "Price fit",
  quantity: "Quantity",
  demand: "Demand outlook",
  reliability: "Track record",
};

const PILLAR_ICON = {
  crop: "🌱",
  distance: "📍",
  price: "💰",
  quantity: "⚖️",
  demand: "📈",
  reliability: "🤝",
};

export function MatchScoreBadge({ score, quality, size = "md" }) {
  const rounded = Math.round(Number(score) || 0);
  const big = size === "lg";

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex shrink-0 flex-col items-center justify-center rounded-full border-4 ${
          big ? "h-20 w-20" : "h-14 w-14"
        } ${RING_COLOR[quality] || RING_COLOR.Weak}`}
        style={{ borderColor: "currentColor" }}
      >
        <span
          className={`font-bold text-slate-900 ${big ? "text-2xl" : "text-lg"} leading-none`}
        >
          {rounded}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
          /100
        </span>
      </div>

      <Badge className={QUALITY_STYLE[quality] || QUALITY_STYLE.Weak}>{quality}</Badge>
    </div>
  );
}

export function MatchBreakdown({ breakdown, compact = false }) {
  if (!breakdown) return null;

  const rows = Object.entries(breakdown);

  return (
    <ul className={compact ? "space-y-2" : "space-y-3"}>
      {rows.map(([key, part]) => {
        const pct = part.max ? (part.score / part.max) * 100 : 0;
        const strong = pct >= 75;
        const weak = pct < 40;

        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700">
                <span className="mr-1">{PILLAR_ICON[key]}</span>
                {PILLAR_LABEL[key] || key}
              </span>
              <span className="shrink-0 font-bold tabular-nums text-slate-500">
                {part.score}
                <span className="font-normal text-slate-400"> / {part.max}</span>
              </span>
            </div>

            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all ${
                  strong ? "bg-emerald-500" : weak ? "bg-amber-400" : "bg-blue-400"
                }`}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Compact reason/limitation lists used on cards and in the modal. */
export function MatchReasons({ reasons = [], limitations = [], max = 99 }) {
  if (reasons.length === 0 && limitations.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {reasons.slice(0, max).map((reason) => (
        <p key={reason} className="flex gap-2 text-xs leading-relaxed text-slate-600">
          <span className="shrink-0 text-emerald-500">✓</span>
          <span>{reason}</span>
        </p>
      ))}
      {limitations.slice(0, max).map((limit) => (
        <p key={limit} className="flex gap-2 text-xs leading-relaxed text-slate-500">
          <span className="shrink-0 text-amber-500">!</span>
          <span>{limit}</span>
        </p>
      ))}
    </div>
  );
}

export function MatchDetailsModal({ open, onClose, match, title, subtitle }) {
  if (!match) return null;

  const total = Object.values(match.scoreBreakdown || {}).reduce(
    (sum, part) => sum + part.score,
    0
  );

  return (
    <Modal open={open} onClose={onClose} title={title} description={subtitle} maxWidth="max-w-xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4">
          <MatchScoreBadge score={match.matchScore} quality={match.matchQuality} size="lg" />
          <p className="max-w-xs text-sm text-slate-600">{match.summary}</p>
        </div>

        <section>
          <h4 className="text-sm font-bold text-slate-900">How the score is made up</h4>
          <p className="mt-1 text-xs text-slate-500">
            Six weighted factors. They add up to the score above
            {Math.abs(total - match.matchScore) < 0.05 ? "" : " (approximately)"}.
          </p>
          <div className="mt-4">
            <MatchBreakdown breakdown={match.scoreBreakdown} />
          </div>
        </section>

        {match.reasons?.length > 0 && (
          <section>
            <h4 className="text-sm font-bold text-slate-900">What works in its favour</h4>
            <div className="mt-2">
              <MatchReasons reasons={match.reasons} />
            </div>
          </section>
        )}

        {match.limitations?.length > 0 && (
          <section>
            <h4 className="text-sm font-bold text-slate-900">What to keep in mind</h4>
            <div className="mt-2">
              <MatchReasons limitations={match.limitations} />
            </div>
          </section>
        )}

        <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
          Match scores rank likely fit from listing data, stated preferences and
          past orders. They are a suggestion to help you shortlist — not a
          guarantee that a deal will happen.
        </p>
      </div>
    </Modal>
  );
}
