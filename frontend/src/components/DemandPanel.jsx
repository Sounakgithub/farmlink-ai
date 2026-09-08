import { useEffect, useState } from "react";
import { ml } from "../lib/api";
import { cropIcon } from "../lib/format";
import { DEMAND_LOCATIONS, MONTH_NAMES } from "../lib/constants";

function nearestKnownLocation(value) {
  const match = DEMAND_LOCATIONS.find((city) =>
    String(value || "").toLowerCase().includes(city.toLowerCase())
  );
  return match || "Delhi";
}

/**
 * AI demand forecast for the coming month, shared by every role.
 */
export default function DemandPanel({ defaultLocation = "Delhi", limit = 8 }) {
  const [location, setLocation] = useState(nearestKnownLocation(defaultLocation));
  const [insights, setInsights] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      setLoading(true);
      setError("");

      try {
        const data = await ml.demandInsights({ location }, controller.signal);
        setInsights(data.insights || []);
        setMeta({ month: data.month, season: data.season });
      } catch (err) {
        if (err.name === "AbortError") return;
        setError(
          err.status === 0
            ? "Forecasting service is offline. Start it with `python app.py` in ml-service."
            : err.message
        );
        setInsights([]);
      } finally {
        setLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [location]);

  const maxDemand = Math.max(1, ...insights.map((i) => i.predicted_demand_kg));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
            Demand forecast
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {meta
              ? `AI prediction for ${MONTH_NAMES[meta.month - 1]} · ${meta.season}`
              : "Predicted demand for next month"}
          </p>
        </div>
        <span className="text-2xl">📈</span>
      </div>

      <select
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        aria-label="Forecast location"
        className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-emerald-500"
      >
        {DEMAND_LOCATIONS.map((city) => (
          <option key={city} value={city}>
            📍 {city}
          </option>
        ))}
      </select>

      {loading ? (
        <div className="mt-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="mb-2 h-4 w-2/3 rounded bg-slate-100" />
              <div className="h-2 rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
          ⚠️ {error}
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          {insights.slice(0, limit).map((item) => {
            const width = Math.max(
              6,
              Math.round((item.predicted_demand_kg / maxDemand) * 100)
            );
            const rising = item.trend_pct >= 0;

            return (
              <div key={item.crop}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-xl">{cropIcon(item.crop)}</span>
                    <span className="truncate text-sm font-medium text-slate-800">
                      {item.crop}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{item.level}</span>
                    <span
                      className={`text-xs font-semibold ${
                        rising ? "text-emerald-600" : "text-rose-500"
                      }`}
                    >
                      {rising ? "↑" : "↓"}
                      {Math.abs(item.trend_pct)}%
                    </span>
                  </div>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${width}%` }}
                  />
                </div>

                <p className="mt-1 text-xs text-slate-400">
                  ~{item.predicted_demand_kg.toLocaleString("en-IN")} kg predicted
                  (avg {item.historical_avg_kg.toLocaleString("en-IN")} kg)
                </p>
              </div>
            );
          })}

          <p className="pt-1 text-xs text-slate-400">
            Trend compares the prediction with the historical average for this
            month. Gradient-boosted model, 3 years of seasonal data.
          </p>
        </div>
      )}
    </section>
  );
}
