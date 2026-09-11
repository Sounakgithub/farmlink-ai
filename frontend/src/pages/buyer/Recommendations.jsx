import { useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../../components/AppShell";
import BuyModal from "../../components/BuyModal";
import StartChatButton from "../../components/StartChatButton";
import {
  MatchScoreBadge,
  MatchBreakdown,
  MatchReasons,
  MatchDetailsModal,
} from "../../components/MatchScore";
import { Button, EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { matching } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { currency, cropIcon } from "../../lib/format";

/**
 * "AI recommended crops" — the buyer side of matching.
 *
 * Ranks the same marketplace listings against this buyer's stated preferences
 * and past orders. Buying still goes through the existing cart and BuyModal.
 */
export default function Recommendations() {
  const [detail, setDetail] = useState(null);
  const [buying, setBuying] = useState(null);

  const { data, loading, error, reload } = useAsyncData(
    () => matching.recommendations({ limit: 10 }),
    { initialData: null }
  );

  const matches = data?.matches || [];
  const personalisation = data?.personalisation;
  const unpersonalised =
    personalisation && !personalisation.hasHistory && !personalisation.hasPreferences;

  return (
    <AppShell
      title="AI Recommended Crops 🤖"
      subtitle="Ranked for you by crop fit, price, distance, demand and farmer track record"
      actions={
        <Button variant="secondary" onClick={reload} disabled={loading}>
          ↻ Refresh
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <Spinner label="Finding the best crops for you…" />
      ) : (
        <div className="space-y-6">
          {/* Nudge a brand-new buyer rather than pretending the scores are personal */}
          {unpersonalised && (
            <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  These are general recommendations for now
                </p>
                <p className="mt-1 text-xs text-blue-800">
                  You have no orders or preferences yet, so everything is scored
                  neutrally. Tell us what you buy and the ranking gets personal.
                </p>
              </div>
              <Button as={Link} to="/profile" variant="secondary" className="shrink-0">
                Set preferences
              </Button>
            </div>
          )}

          {data?.demandForecastAvailable === false && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              ⚠️ The demand forecasting service is offline, so the demand part of
              each score is a neutral placeholder.
            </p>
          )}

          {matches.length === 0 ? (
            <EmptyState
              icon="🌾"
              title="Nothing to recommend yet"
              description="No crops are listed right now. Check back soon — farmers add fresh produce every day."
              action={
                <Button as={Link} to="/market">
                  Browse the marketplace
                </Button>
              }
            />
          ) : (
            <>
              <p className="text-sm text-slate-500">
                Showing {matches.length} of {data.candidatesConsidered} listing
                {data.candidatesConsidered === 1 ? "" : "s"}, best fit first.
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                {matches.map((match, index) => {
                  const product = match.product;

                  return (
                    <article
                      key={match.id}
                      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="text-3xl">{cropIcon(product.cropName)}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-400">
                              #{index + 1}
                            </p>
                            <h3 className="truncate text-base font-bold text-slate-900">
                              {product.cropName}
                            </h3>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              👨‍🌾 {product.farmerName} · 📍 {product.location}
                              {match.distanceKm != null && ` · ~${match.distanceKm} km`}
                            </p>
                          </div>
                        </div>

                        <MatchScoreBadge score={match.matchScore} quality={match.matchQuality} />
                      </div>

                      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <span className="text-lg font-bold text-emerald-600">
                          {currency(product.pricePerKg)}
                          <span className="text-xs font-normal text-slate-500"> / kg</span>
                        </span>
                        <span className="text-xs text-slate-500">
                          {product.quantity.toLocaleString("en-IN")} {product.unit} available
                        </span>
                      </div>

                      <p className="mt-2 text-sm text-slate-600">{match.summary}</p>

                      <div className="mt-4 rounded-xl bg-slate-50 p-3">
                        <MatchBreakdown breakdown={match.scoreBreakdown} compact />
                      </div>

                      <div className="mt-4 flex-1">
                        <MatchReasons
                          reasons={match.reasons}
                          limitations={match.limitations}
                          max={2}
                        />
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Button
                          onClick={() => setBuying(product)}
                          disabled={!product.inStock}
                          className="col-span-2 sm:col-span-1"
                        >
                          {product.inStock ? "🧺 Add to cart" : "Sold out"}
                        </Button>

                        <Button
                          variant="secondary"
                          onClick={() => setDetail(match)}
                          className="col-span-2 sm:col-span-1"
                        >
                          Why this match?
                        </Button>

                        <Button as={Link} to="/market" variant="outline">
                          View product
                        </Button>

                        <StartChatButton
                          kind="buyer-farmer"
                          productId={product._id}
                          label="💬 Contact"
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      <MatchDetailsModal
        open={!!detail}
        onClose={() => setDetail(null)}
        match={detail}
        title={detail ? `${detail.product.cropName} — match details` : ""}
        subtitle={detail ? `From ${detail.product.farmerName}` : ""}
      />

      <BuyModal product={buying} open={!!buying} onClose={() => setBuying(null)} />
    </AppShell>
  );
}
