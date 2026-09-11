import { useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../../components/AppShell";
import StartChatButton from "../../components/StartChatButton";
import {
  MatchScoreBadge,
  MatchBreakdown,
  MatchReasons,
  MatchDetailsModal,
} from "../../components/MatchScore";
import { Button, EmptyState, ErrorNote, Spinner, inputClass } from "../../components/ui";
import { api, matching } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { currency, cropIcon } from "../../lib/format";

/**
 * "Find best buyers" — the farmer side of AI matching.
 *
 * Picks one of the farmer's own crops and ranks buyers for it. The listing
 * itself is untouched; this is a planning layer over the same marketplace.
 */
export default function BuyerMatches() {
  const [productId, setProductId] = useState("");
  const [result, setResult] = useState(null);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [detail, setDetail] = useState(null);

  const { data: products, loading, error, reload } = useAsyncData(
    () => api.get("/products/mine"),
    { initialData: [] }
  );

  const selected = products.find((p) => p._id === productId) || null;

  const findBuyers = async (id) => {
    if (!id) return;
    setLoadingMatches(true);
    setMatchError("");
    setResult(null);
    try {
      setResult(await matching.buyersForProduct(id));
    } catch (err) {
      setMatchError(err.message || "Could not load buyer matches.");
    } finally {
      setLoadingMatches(false);
    }
  };

  const choose = (id) => {
    setProductId(id);
    findBuyers(id);
  };

  return (
    <AppShell
      title="AI Buyer Matches 🤝"
      subtitle="Find the buyers most likely to want each of your crops"
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <Spinner label="Loading your crops…" />
      ) : products.length === 0 ? (
        <EmptyState
          icon="🌱"
          title="List a crop first"
          description="Once you have a crop listed, we can rank the buyers most likely to want it."
          action={
            <Button as={Link} to="/farmer/products">
              Add your first crop
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Crop picker */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">Which crop are you selling?</h2>
            <p className="mt-1 text-sm text-slate-500">
              We rank buyers on crop fit, distance, price, quantity, demand and track record.
            </p>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <select
                value={productId}
                onChange={(e) => choose(e.target.value)}
                className={inputClass}
              >
                <option value="">Choose one of your crops…</option>
                {products.map((product) => (
                  <option key={product._id} value={product._id}>
                    {product.cropName} · {product.quantity} {product.unit} ·{" "}
                    {currency(product.pricePerKg)}/kg · {product.location}
                  </option>
                ))}
              </select>

              <Button
                className="shrink-0 sm:w-48"
                disabled={!productId || loadingMatches}
                onClick={() => findBuyers(productId)}
              >
                {loadingMatches ? "Matching…" : "🔍 Find best buyers"}
              </Button>
            </div>

            {selected && selected.quantity === 0 && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                ⚠️ This crop is sold out. Buyers are still ranked, but quantity fit
                will score zero until you restock.
              </p>
            )}
          </section>

          {matchError && <ErrorNote message={matchError} onRetry={() => findBuyers(productId)} />}

          {loadingMatches && <Spinner label="Ranking buyers…" />}

          {result && !loadingMatches && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {cropIcon(result.product.cropName)} Top buyers for {result.product.cropName}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {result.count} of {result.candidatesConsidered} buyer
                    {result.candidatesConsidered === 1 ? "" : "s"} considered
                  </p>
                </div>

                {result.demandForecastAvailable === false && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    ⚠️ Demand forecast offline — scored neutrally
                  </span>
                )}
              </div>

              {result.matches.length === 0 ? (
                <EmptyState
                  icon="🧑‍🍳"
                  title="No buyers to rank yet"
                  description="As soon as buyers join FarmLink they will be matched against your crops automatically."
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {result.matches.map((match, index) => (
                    <article
                      key={match.id}
                      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-400">#{index + 1}</p>
                          <h3 className="truncate text-base font-bold text-slate-900">
                            {match.buyer.name}
                          </h3>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            📍 {match.buyer.location || "Location not set"}
                            {match.distanceKm != null && ` · ~${match.distanceKm} km away`}
                          </p>
                        </div>

                        <MatchScoreBadge score={match.matchScore} quality={match.matchQuality} />
                      </div>

                      <p className="mt-3 text-sm text-slate-600">{match.summary}</p>

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

                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <Button
                          variant="secondary"
                          className="flex-1"
                          onClick={() => setDetail(match)}
                        >
                          Why this match?
                        </Button>

                        <StartChatButton
                          kind="buyer-farmer"
                          productId={result.product._id}
                          buyerId={match.buyer.id}
                          label="💬 Contact buyer"
                          className="flex-1"
                        />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <MatchDetailsModal
        open={!!detail}
        onClose={() => setDetail(null)}
        match={detail}
        title={detail ? `${detail.buyer.name} — match details` : ""}
        subtitle={result ? `For your ${result.product.cropName} listing` : ""}
      />
    </AppShell>
  );
}
