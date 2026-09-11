import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import DeliveryMap, { MapLegend } from "../../components/DeliveryMap";
import StartChatButton from "../../components/StartChatButton";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  Spinner,
  StatCard,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  currency,
  cropIcon,
  formatDuration,
  shortId,
  statusLabel,
  statusStyle,
} from "../../lib/format";

const DEPOT = { lat: 28.6139, lng: 77.209, label: "FarmLink Depot" };

/**
 * Streams this driver's GPS to whichever order is currently in transit, and
 * hands the position back so the map can draw it.
 */
function useDriverPosition(orderId) {
  const [position, setPosition] = useState(null);
  // Decided once, at mount, rather than set from inside the effect - which
  // would kick off an extra render pass on every device without GPS.
  const [gpsError, setGpsError] = useState(() =>
    typeof navigator !== "undefined" && navigator.geolocation
      ? ""
      : "This device cannot share a location."
  );

  useEffect(() => {
    if (!navigator.geolocation) return undefined;

    const watchId = navigator.geolocation.watchPosition(
      async (location) => {
        const { latitude, longitude } = location.coords;
        setPosition({ lat: latitude, lng: longitude });
        setGpsError("");

        if (!orderId) return;
        try {
          await api.patch(`/orders/${orderId}/location`, { latitude, longitude });
        } catch (error) {
          console.error("Could not save driver location:", error.message);
        }
      },
      (error) => setGpsError(error.message || "Location sharing is off."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [orderId]);

  return { position, gpsError };
}

export default function DriverDashboard() {
  const { user } = useAuth();
  const toast = useToast();

  const { data, loading, error, reload } = useAsyncData(
    async () => {
      const orders = await api.get("/orders");

      const routable = orders.filter((o) =>
        ["Accepted", "Confirmed", "In Transit"].includes(o.status)
      );

      if (routable.length === 0) {
        return {
          orders,
          plan: null,
          routeError: "No deliveries assigned yet — accepted orders appear here.",
        };
      }

      try {
        const plan = await api.post("/routes/optimize-orders", {
          start: DEPOT,
          roundTrip: true,
        });
        return { orders, plan, routeError: "" };
      } catch (err) {
        return { orders, plan: null, routeError: err.message };
      }
    },
    { initialData: { orders: [], plan: null, routeError: "" } }
  );

  const { orders, plan, routeError } = data;
  const [busyId, setBusyId] = useState(null);

  const updateStatus = async (orderId, status) => {
    setBusyId(orderId);
    try {
      const result = await api.patch(`/orders/${orderId}/status`, { status });
      toast.success(result.message);
      await reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const inTransit = orders.find((o) => o.status === "In Transit");
  const delivered = orders.filter((o) => o.status === "Delivered").length;
  const assigned = orders.filter((o) =>
    ["Accepted", "Confirmed", "In Transit"].includes(o.status)
  );

  // Live GPS, streamed to the order currently in transit.
  const { position: driverPosition, gpsError } = useDriverPosition(inTransit?._id);

  // A stop is behind us once its order has moved past that phase.
  const stopDone = (stop) => {
    const order = orders.find((o) => o._id === stop.orderId);
    if (!order) return false;
    if (stop.type === "pickup") return ["In Transit", "Delivered"].includes(order.status);
    return order.status === "Delivered";
  };

  const mapStops = (plan?.stops || []).map((stop) => ({ ...stop, done: stopDone(stop) }));

  return (
    <AppShell
      title={`Deliveries · ${user?.name?.split(" ")[0] || "Driver"} 🚚`}
      subtitle="Your optimised route for today"
      actions={
        <Button variant="secondary" onClick={reload} className="whitespace-nowrap">
          ↻ Refresh
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <Spinner label="Planning your route…" />
      ) : (
        <div className="space-y-8">
          {/* Stats */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="📍"
              tone="emerald"
              label="Stops today"
              value={plan?.stopCount ?? assigned.length * 2}
              hint={plan ? plan.jobCount + " orders · collect + deliver" : "Assigned deliveries"}
            />
            <StatCard
              icon="🛣️"
              tone="blue"
              label="Route distance"
              value={plan ? `${plan.totalDistanceKm} km` : "—"}
              hint={plan ? `${plan.improvementPct}% shorter than unsorted` : "No route yet"}
            />
            <StatCard
              icon="⏱️"
              tone="amber"
              label="Estimated time"
              value={plan ? formatDuration(plan.totalTimeMin) : "—"}
              hint={
                plan
                  ? `${formatDuration(plan.drivingTimeMin)} driving + ${plan.serviceTimeMin}m stops`
                  : "No route yet"
              }
            />
            <StatCard
              icon="✓"
              tone="purple"
              label="Completed"
              value={delivered}
              hint="Delivered orders"
            />
          </section>

          {/* Map */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                  🧭 Optimised route
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {plan
                    ? `${plan.jobCount} orders · ${plan.stopCount} stops${plan.roundTrip ? " · round trip" : ""} · pickup-before-delivery 2-opt`
                    : "Waiting for deliveries to route"}
                </p>
              </div>

              {plan && (
                <Badge className="bg-emerald-100 text-emerald-700">
                  Saves {plan.distanceSavedKm} km ({plan.improvementPct}%)
                </Badge>
              )}
            </div>

            {routeError && (
              <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">
                ⚠️ {routeError}
              </p>
            )}

            <div className="mt-5">
              <DeliveryMap
                stops={mapStops}
                waypoints={plan?.waypoints || []}
                start={plan?.start || DEPOT}
                driver={driverPosition}
              />
              <MapLegend approximate={plan?.approxStops?.length > 0} />
            </div>

            {gpsError && (
              <p className="mt-3 text-xs text-amber-600">
                ⚠️ {gpsError} Buyers will not see you move on their tracking map.
              </p>
            )}

            {plan?.approxStops?.length > 0 && (
              <p className="mt-2 text-xs text-amber-600">
                ⚠️ Approximate location used for: {plan.approxStops.join(", ")} —
                these pins are a best guess, not a surveyed address.
              </p>
            )}
          </section>

          {/* Ordered stop list */}
          <section>
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
              Stop-by-stop queue
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Every order is a collection then a delivery. Visit these in order
              for the shortest run — each pickup is always planned ahead of
              its own drop-off.
            </p>

            {assigned.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  icon="🚚"
                  title="No deliveries assigned"
                  description="Once a farmer accepts an order it will appear here with an optimised route."
                />
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {(
                  plan?.stops ||
                  // Fallback shape while the planner is unavailable: still show
                  // both halves of every order rather than the farm alone.
                  assigned.flatMap((o, i) => [
                    {
                      sequence: i * 2 + 1,
                      type: "pickup",
                      orderId: o._id,
                      crop: o.products[0]?.cropName,
                      place: o.products[0]?.location || "Unknown",
                      amount: o.totalAmount,
                      status: o.status,
                    },
                    {
                      sequence: i * 2 + 2,
                      type: "dropoff",
                      orderId: o._id,
                      crop: o.products[0]?.cropName,
                      buyerName: o.buyerName,
                      place: o.deliveryAddress || "Delivery address",
                      amount: o.totalAmount,
                      status: o.status,
                    },
                  ])
                ).map((stop) => {
                  const order = orders.find((o) => o._id === stop.orderId);
                  const status = order?.status || stop.status;
                  const isPickup = stop.type === "pickup";
                  const done = stopDone(stop);

                  return (
                    <div
                      key={`${stop.type}-${stop.orderId}-${stop.sequence}`}
                      className={`flex flex-col gap-4 rounded-2xl border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5 ${
                        done
                          ? "border-slate-200 bg-slate-50 opacity-70"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <span
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-bold ${
                            done
                              ? "bg-slate-200 text-slate-500"
                              : isPickup
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {done ? "✓" : stop.sequence}
                        </span>

                        <div className="min-w-0">
                          <p
                            className={`text-[11px] font-bold uppercase tracking-wide ${
                              isPickup ? "text-emerald-600" : "text-blue-600"
                            }`}
                          >
                            {isPickup ? "🌾 Collect from farm" : "🏠 Deliver to buyer"}
                          </p>
                          <h3 className="truncate font-bold text-slate-900">
                            {cropIcon(stop.crop)} {stop.crop}
                            {!isPickup && stop.buyerName ? ` — ${stop.buyerName}` : ""}
                          </h3>
                          <p className="mt-0.5 truncate text-sm text-slate-500">
                            {shortId(stop.orderId)} · 📍 {stop.place}
                            {stop.approxLocation ? " (approx)" : ""}
                            {stop.cumulativeKm != null
                              ? ` · ${stop.cumulativeKm} km in`
                              : ""}
                            {stop.etaMinutes != null
                              ? ` · ~${formatDuration(stop.etaMinutes)}`
                              : ""}
                          </p>

                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                        {!isPickup && (
                          <span className="font-bold text-emerald-600">
                            {currency(stop.amount)}
                          </span>
                        )}

                        <Badge className={statusStyle(status)}>
                          {statusLabel(status)}
                        </Badge>

                        {isPickup && ["Accepted", "Confirmed"].includes(status) && (
                          <Button
                            disabled={busyId === stop.orderId}
                            onClick={() => updateStatus(stop.orderId, "In Transit")}
                          >
                            {busyId === stop.orderId ? "Working…" : "🚚 Collected"}
                          </Button>
                        )}

                        {!isPickup && status === "In Transit" && (
                          <>
                            <StartChatButton
                              kind="buyer-driver"
                              orderId={stop.orderId}
                              label="💬 Buyer"
                              variant="outline"
                            />
                            <Button
                              disabled={busyId === stop.orderId}
                              onClick={() => updateStatus(stop.orderId, "Delivered")}
                            >
                              {busyId === stop.orderId ? "Working…" : "✓ Delivered"}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
