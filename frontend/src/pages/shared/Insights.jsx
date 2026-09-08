import { useState } from "react";
import AppShell from "../../components/AppShell";
import DemandPanel from "../../components/DemandPanel";
import { Button, inputClass } from "../../components/ui";
import { ml } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { cropIcon } from "../../lib/format";
import {
  DEMAND_LOCATIONS,
  KNOWN_CROPS as CROPS,
  MONTH_SHORT as MONTHS,
} from "../../lib/constants";

/** AI insights page — available to every role. */
export default function Insights() {
  const { user } = useAuth();
  const toast = useToast();

  const [forecastForm, setForecastForm] = useState({
    crop: "Tomato",
    location: "Delhi",
    horizon: 6,
  });
  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  const [priceForm, setPriceForm] = useState({
    crop: "Tomato",
    location: "Delhi",
    quantity: 500,
    demand: 8,
    market_price: 26,
  });
  const [price, setPrice] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);

  const offline = (error) =>
    error.status === 0
      ? "ML service is offline. Start it with `python app.py` in ml-service."
      : error.message;

  const runForecast = async (e) => {
    e.preventDefault();
    setForecastLoading(true);
    try {
      const data = await ml.forecastDemand({
        crop: forecastForm.crop,
        location: forecastForm.location,
        horizon: Number(forecastForm.horizon),
      });
      setForecast(data);
    } catch (error) {
      toast.error(offline(error));
    } finally {
      setForecastLoading(false);
    }
  };

  const runPrice = async (e) => {
    e.preventDefault();
    setPriceLoading(true);
    try {
      const data = await ml.predictPrice({
        crop: priceForm.crop,
        location: priceForm.location,
        quantity: Number(priceForm.quantity),
        demand: Number(priceForm.demand),
        market_price: Number(priceForm.market_price),
      });
      setPrice(data.recommended_price);
    } catch (error) {
      toast.error(offline(error));
    } finally {
      setPriceLoading(false);
    }
  };

  const maxForecast = forecast
    ? Math.max(...forecast.forecast.map((f) => f.predicted_demand_kg))
    : 1;

  return (
    <AppShell
      title="AI Insights 🤖"
      subtitle="Demand forecasting and price recommendations"
    >
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <DemandPanel defaultLocation={user?.location || "Delhi"} limit={10} />
        </div>

        <div className="space-y-6 xl:col-span-2">
          {/* Multi-month forecast */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
              📈 Multi-month demand forecast
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Predict how demand for a crop will move over the coming months.
            </p>

            <form onSubmit={runForecast} className="mt-5 grid gap-4 sm:grid-cols-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Crop</span>
                <select
                  value={forecastForm.crop}
                  onChange={(e) =>
                    setForecastForm({ ...forecastForm, crop: e.target.value })
                  }
                  className={inputClass}
                >
                  {CROPS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Location</span>
                <select
                  value={forecastForm.location}
                  onChange={(e) =>
                    setForecastForm({ ...forecastForm, location: e.target.value })
                  }
                  className={inputClass}
                >
                  {DEMAND_LOCATIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Months</span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={forecastForm.horizon}
                  onChange={(e) =>
                    setForecastForm({ ...forecastForm, horizon: e.target.value })
                  }
                  className={inputClass}
                />
              </label>

              <div className="flex items-end">
                <Button type="submit" className="w-full py-3" disabled={forecastLoading}>
                  {forecastLoading ? "Predicting…" : "Forecast"}
                </Button>
              </div>
            </form>

            {forecast && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-slate-700">
                  {cropIcon(forecast.crop)} {forecast.crop} · {forecast.location}
                </p>

                <div className="mt-4 flex items-end gap-2 overflow-x-auto pb-2 sm:gap-3">
                  {forecast.forecast.map((point) => {
                    const height = Math.max(
                      12,
                      Math.round((point.predicted_demand_kg / maxForecast) * 100)
                    );
                    return (
                      <div
                        key={point.month}
                        className="flex min-w-14 flex-1 flex-col items-center gap-2"
                      >
                        <span className="text-xs font-semibold text-slate-600">
                          {(point.predicted_demand_kg / 1000).toFixed(1)}t
                        </span>

                        <div className="flex h-32 w-full items-end rounded-lg bg-slate-100">
                          <div
                            className="w-full rounded-lg bg-emerald-500 transition-all"
                            style={{ height: `${height}%` }}
                            title={`${point.predicted_demand_kg} kg · ${point.level}`}
                          />
                        </div>

                        <span className="text-xs font-medium text-slate-500">
                          {MONTHS[point.month - 1]}
                        </span>
                        <span
                          className={`text-[10px] font-semibold ${
                            point.trend_pct >= 0 ? "text-emerald-600" : "text-rose-500"
                          }`}
                        >
                          {point.trend_pct >= 0 ? "↑" : "↓"}
                          {Math.abs(point.trend_pct)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Price advisor */}
          <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-green-100 p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-emerald-950 sm:text-xl">
              💰 Smart price advisor
            </h2>
            <p className="mt-1 text-sm text-emerald-800">
              A data-driven selling price based on crop, location, quantity,
              demand and current market conditions.
            </p>

            <form onSubmit={runPrice} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Crop</span>
                <select
                  value={priceForm.crop}
                  onChange={(e) => setPriceForm({ ...priceForm, crop: e.target.value })}
                  className={inputClass}
                >
                  {CROPS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Location</span>
                <select
                  value={priceForm.location}
                  onChange={(e) =>
                    setPriceForm({ ...priceForm, location: e.target.value })
                  }
                  className={inputClass}
                >
                  {DEMAND_LOCATIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Quantity (kg)
                </span>
                <input
                  type="number"
                  min="1"
                  value={priceForm.quantity}
                  onChange={(e) =>
                    setPriceForm({ ...priceForm, quantity: e.target.value })
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Demand (1–10)
                </span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={priceForm.demand}
                  onChange={(e) =>
                    setPriceForm({ ...priceForm, demand: e.target.value })
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Market price (₹/kg)
                </span>
                <input
                  type="number"
                  min="1"
                  value={priceForm.market_price}
                  onChange={(e) =>
                    setPriceForm({ ...priceForm, market_price: e.target.value })
                  }
                  className={inputClass}
                />
              </label>

              <div className="flex items-end">
                <Button type="submit" className="w-full py-3" disabled={priceLoading}>
                  {priceLoading ? "Asking AI…" : "Get recommendation"}
                </Button>
              </div>
            </form>

            {price !== null && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-white p-5 text-center">
                <p className="text-sm text-slate-500">AI recommended price</p>
                <p className="mt-2 text-4xl font-bold text-emerald-700">₹{price}</p>
                <p className="mt-1 text-sm text-slate-500">per kg</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
