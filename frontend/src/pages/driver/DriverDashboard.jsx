import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import DeliveryMap, { MapLegend } from "../../components/DeliveryMap";
import StartChatButton from "../../components/StartChatButton";
import InspectionForm from "../../components/InspectionForm";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  SectionHeader,
  SkeletonCards,
  SkeletonRows,
  StatCard,
} from "../../components/ui";
import { api, operations } from "../../lib/api";
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
          routeError: "",
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
  const [inspecting, setInspecting] = useState(null);
  const [tolerancePct, setTolerancePct] = useState(5);

  const openInspection = async (orderId) => {
    const order = orders.find((o) => o._id === orderId);
    if (!order) return;
    setInspecting(order);
    try {
      const policy = await operations.inspectionPolicy();
      setTolerancePct(policy.weightTolerancePct);
    } catch {
      /* keep the default tolerance */
    }
  };

  const collect = async (inspection) => {
    const orderId = inspecting._id;
    setBusyId(orderId);
    try {
      const result = await operations.collectWithInspection(orderId, inspection);
      toast.success(result.message);
      setInspecting(null);
      await reload();
    } catch (err) {
      if (err.data?.code === "PICKUP_INSPECTION_FAILED") {
        toast.error("Inspection failed — the order was rejected and the buyer refunded.");
        setInspecting(null);
        await reload();
      } else {
        toast.error(err.data?.problems?.[0] || err.message);
      }
    } finally {
      setBusyId(null);
    }
  };

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

  const mapStops = (plan?.stops || []).map((stop) => ({
    ...stop,
    done: stopDone(stop),
  }));

  // Earnings: what the delivery jobs this driver completed paid.
  const earnings = orders
    .filter((o) => o.status === "Delivered" && o.driverId === user?.id)
    .reduce((sum, o) => sum + (o.charges?.deliveryPayout || 0), 0);

  // The queue, either from the optimised plan or a straight fallback.
  const queue =
    plan?.stops ||
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
    ]);

  // The next thing to actually do.
  const nextStop = queue.find((stop) => !stopDone(stop));

  return (
    <AppShell
      title={`On the road, ${user?.name?.split(" ")[0] || "Driver"}`}
      subtitle="Your optimised run for today"
      actions={
        <Button variant="secondary" onClick={reload} className="whitespace-nowrap">
          ↻ Refresh
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} className="mb-6" />}

      <div className="space-y-10">
        {/* ---------------- active delivery ---------------- */}
        {inTransit && (
          <section className="fl-soil relative overflow-hidden rounded-2xl p-6 sm:p-7">
            <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-50" />
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/18 blur-3xl" />

            <div className="relative">
              <p className="fl-eyebrow flex items-center gap-2 text-brand-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-400" />
                </span>
                Active delivery
              </p>

              <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
                {/* the leg, drawn as a journey */}
                <div className="space-y-0">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center pt-1">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500/20 text-sm ring-1 ring-brand-400/30">
                        🌾
                      </span>
                      <span className="my-1 w-0.5 flex-1 rounded-full bg-white/15" style={{ minHeight: "26px" }} />
                    </div>
                    <div className="min-w-0 pt-1.5">
                      <p className="fl-eyebrow text-white/35">Pickup</p>
                      <p className="mt-0.5 truncate font-bold text-white">
                        {inTransit.products[0]?.location || "Farm"}
                      </p>
                      <p className="truncate text-xs text-white/45">
                        {inTransit.products.map((p) => p.cropName).join(", ")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm ring-1 ring-white/15">
                        🏠
                      </span>
                    </div>
                    <div className="min-w-0 pt-1.5">
                      <p className="fl-eyebrow text-white/35">Delivery</p>
                      <p className="mt-0.5 truncate font-bold text-white">
                        {inTransit.deliveryAddress || "Buyer address"}
                      </p>
                      <p className="truncate text-xs text-white/45">
                        {inTransit.buyerName} · {shortId(inTransit._id)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* actions */}
                <div className="flex flex-col gap-2.5 lg:w-56">
                  {plan && (
                    <div className="rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                      <p className="fl-numeric text-2xl font-bold text-white">
                        {formatDuration(plan.totalTimeMin)}
                      </p>
                      <p className="fl-numeric mt-0.5 text-xs text-white/45">
                        {plan.totalDistanceKm} km · {plan.stopCount} stops
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={() => updateStatus(inTransit._id, "Delivered")}
                    loading={busyId === inTransit._id}
                    className="w-full"
                  >
                    ✓ Mark delivered
                  </Button>

                  <StartChatButton
                    kind="buyer-driver"
                    orderId={inTransit._id}
                    label="💬 Contact buyer"
                    variant="ghost"
                    className="w-full text-white ring-1 ring-white/15 hover:bg-white/10 hover:text-white"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ---------------- stats ---------------- */}
        {loading ? (
          <SkeletonCards count={4} />
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="◱"
              tone="emerald"
              label="Stops today"
              value={plan?.stopCount ?? assigned.length * 2}
              hint={
                plan
                  ? `${plan.jobCount} order${plan.jobCount === 1 ? "" : "s"} · collect + deliver`
                  : "Assigned deliveries"
              }
            />
            <StatCard
              icon="➔"
              tone="blue"
              label="Route distance"
              value={plan ? `${plan.totalDistanceKm} km` : "—"}
              hint={plan ? `${plan.improvementPct}% shorter than unsorted` : "No route yet"}
              trend={plan?.improvementPct}
            />
            <StatCard
              icon="◷"
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
              hint={earnings > 0 ? `${currency(earnings)} earned from deliveries` : "Delivered orders"}
            />
          </section>
        )}

        {/* ---------------- route map ---------------- */}
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="fl-eyebrow text-brand-700">Navigation</p>
              <h2 className="mt-1.5 text-xl font-bold tracking-tight text-ink">
                Optimised route
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                {plan
                  ? `${plan.jobCount} order${plan.jobCount === 1 ? "" : "s"} · ${plan.stopCount} stops${plan.roundTrip ? " · round trip" : ""}`
                  : "Waiting for deliveries to route"}
              </p>
            </div>

            {plan && (
              <Badge tone="brand">
                Saves {plan.distanceSavedKm} km ({plan.improvementPct}%)
              </Badge>
            )}
          </div>

          {routeError && (
            <p className="mt-4 rounded-xl bg-harvest-50 p-3 text-sm text-harvest-700 ring-1 ring-harvest-100">
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
            <p className="mt-3 text-xs text-harvest-700">
              ⚠️ {gpsError} Buyers will not see you move on their tracking map.
            </p>
          )}

          {plan?.approxStops?.length > 0 && (
            <p className="mt-2 text-xs text-harvest-700">
              ⚠️ Approximate location used for: {plan.approxStops.join(", ")} —
              these pins are a best guess, not a surveyed address.
            </p>
          )}
        </Card>

        {/* ---------------- queue ---------------- */}
        <section>
          <SectionHeader
            title="Stop-by-stop queue"
            description="Every order is a collection then a delivery. Each pickup is always planned ahead of its own drop-off."
            action={
              nextStop && (
                <Badge tone="amber">
                  Next: {nextStop.type === "pickup" ? "collect" : "deliver"} ·{" "}
                  {nextStop.place}
                </Badge>
              )
            }
          />

          <div className="mt-5">
            {loading ? (
              <SkeletonRows count={4} />
            ) : assigned.length === 0 ? (
              <EmptyState
                icon="🚚"
                title="No deliveries assigned"
                description="Once a farmer accepts an order it appears here with an optimised route from farm to door."
              />
            ) : (
              <div className="space-y-3">
                {queue.map((stop, index) => {
                  const order = orders.find((o) => o._id === stop.orderId);
                  const status = order?.status || stop.status;
                  const isPickup = stop.type === "pickup";
                  const done = stopDone(stop);
                  const isNext = nextStop && stop === nextStop;

                  return (
                    <Card
                      key={`${stop.type}-${stop.orderId}-${stop.sequence}`}
                      className={`animate-fade-up p-4 transition-opacity sm:p-5 ${
                        done ? "opacity-60" : ""
                      } ${isNext ? "ring-2 ring-brand-500/40" : ""}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                          <span
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
                              done
                                ? "bg-canvas text-ink-faint ring-1 ring-line"
                                : isPickup
                                  ? "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
                                  : "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                            }`}
                          >
                            {done ? "✓" : stop.sequence}
                          </span>

                          <div className="min-w-0">
                            <p
                              className={`fl-eyebrow ${
                                isPickup ? "text-brand-700" : "text-sky-700"
                              }`}
                            >
                              {isPickup ? "🌾 Collect from farm" : "🏠 Deliver to buyer"}
                            </p>
                            <h3 className="mt-0.5 truncate font-bold text-ink">
                              {cropIcon(stop.crop)} {stop.crop}
                              {!isPickup && stop.buyerName ? ` — ${stop.buyerName}` : ""}
                            </h3>
                            <p className="mt-0.5 truncate text-xs text-ink-soft">
                              {shortId(stop.orderId)} · 📍 {stop.place}
                              {stop.approxLocation ? " (approx)" : ""}
                              {stop.cumulativeKm != null ? ` · ${stop.cumulativeKm} km in` : ""}
                              {stop.etaMinutes != null
                                ? ` · ~${formatDuration(stop.etaMinutes)}`
                                : ""}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                          {!isPickup && (
                            <span className="fl-numeric font-bold text-ink">
                              {currency(stop.amount)}
                            </span>
                          )}

                          <Badge className={statusStyle(status)}>
                            {statusLabel(status)}
                          </Badge>

                          {isPickup && ["Accepted", "Confirmed"].includes(status) && (
                            <Button
                              loading={busyId === stop.orderId}
                              onClick={() => openInspection(stop.orderId)}
                            >
                              🔍 Inspect & collect
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
                                loading={busyId === stop.orderId}
                                onClick={() => updateStatus(stop.orderId, "Delivered")}
                              >
                                ✓ Delivered
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <InspectionForm
        open={!!inspecting}
        order={inspecting}
        weightTolerancePct={tolerancePct}
        busy={!!inspecting && busyId === inspecting._id}
        onSubmit={collect}
        onClose={() => setInspecting(null)}
      />
    </AppShell>
  );
}
