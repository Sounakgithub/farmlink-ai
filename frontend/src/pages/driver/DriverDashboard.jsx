import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import AppShell from "../../components/AppShell";
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

const depotIcon = L.divIcon({
  html: "🏬",
  className: "",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const driverIcon = L.divIcon({
  html: "🚚",
  className: "",
  iconSize: [35, 35],
  iconAnchor: [17, 17],
});

// numbered pin showing the optimised visiting order
const stopIcon = (n) =>
  L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    html: `<div style="
      background:#059669;color:#fff;font-weight:700;font-size:12px;
      width:24px;height:24px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">
      <span style="transform:rotate(45deg)">${n}</span>
    </div>`,
  });

/** Streams the driver's GPS to whichever order is currently in transit. */
function DriverLocationMarker({ orderId }) {
  const [position, setPosition] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return undefined;

    const watchId = navigator.geolocation.watchPosition(
      async (location) => {
        const { latitude, longitude } = location.coords;
        setPosition([latitude, longitude]);

        if (!orderId) return;
        try {
          await api.patch(`/orders/${orderId}/location`, { latitude, longitude });
        } catch (error) {
          console.error("Could not save driver location:", error.message);
        }
      },
      (error) => console.error("GPS error:", error.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [orderId]);

  if (!position) return null;

  return (
    <Marker position={position} icon={driverIcon}>
      <Popup>🚚 You are here</Popup>
    </Marker>
  );
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

  const mapCentre = plan?.waypoints?.length
    ? [
        plan.waypoints.reduce((s, p) => s + p.lat, 0) / plan.waypoints.length,
        plan.waypoints.reduce((s, p) => s + p.lng, 0) / plan.waypoints.length,
      ]
    : [DEPOT.lat, DEPOT.lng];

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
              value={plan?.stopCount ?? assigned.length}
              hint="Assigned deliveries"
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
                    ? `${plan.stopCount} stops${plan.roundTrip ? " · round trip" : ""} · nearest-neighbour + 2-opt`
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

            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
              <MapContainer
                key={plan ? "optimised" : "default"}
                center={mapCentre}
                zoom={plan ? 9 : 11}
                scrollWheelZoom
                className="h-72 w-full sm:h-96"
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <DriverLocationMarker orderId={inTransit?._id} />

                <Marker
                  position={[plan?.start?.lat ?? DEPOT.lat, plan?.start?.lng ?? DEPOT.lng]}
                  icon={depotIcon}
                >
                  <Popup>🏬 {plan?.start?.label || DEPOT.label}</Popup>
                </Marker>

                {plan?.order.map((stop) => (
                  <Marker
                    key={stop.orderId || stop.sequence}
                    position={[stop.lat, stop.lng]}
                    icon={stopIcon(stop.sequence)}
                  >
                    <Popup>
                      <strong>
                        Stop {stop.sequence}: {stop.crop}
                      </strong>
                      <br />
                      {stop.buyerName && (
                        <>
                          Buyer: {stop.buyerName}
                          <br />
                        </>
                      )}
                      📍 {stop.location}
                      {stop.approxLocation ? " (approx)" : ""}
                      <br />
                      {currency(stop.amount)}
                    </Popup>
                  </Marker>
                ))}

                {plan && (
                  <Polyline
                    positions={plan.waypoints.map((p) => [p.lat, p.lng])}
                    pathOptions={{ color: "#059669", weight: 4 }}
                  />
                )}
              </MapContainer>
            </div>

            {plan?.approxStops?.length > 0 && (
              <p className="mt-3 text-xs text-amber-600">
                ⚠️ Approximate location used for: {plan.approxStops.join(", ")}
              </p>
            )}
          </section>

          {/* Ordered stop list */}
          <section>
            <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
              Delivery queue
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Visit these in order for the shortest route
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
                {(plan?.order || assigned.map((o, i) => ({
                  sequence: i + 1,
                  orderId: o._id,
                  crop: o.products[0]?.cropName,
                  buyerName: o.buyerName,
                  location: o.products[0]?.location || "Unknown",
                  amount: o.totalAmount,
                  status: o.status,
                }))).map((stop, index) => {
                  const order = orders.find((o) => o._id === stop.orderId);
                  const status = order?.status || stop.status;

                  return (
                    <div
                      key={stop.orderId || stop.sequence}
                      className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5"
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 font-bold text-emerald-700">
                          {stop.sequence}
                        </span>

                        <div className="min-w-0">
                          <h3 className="truncate font-bold text-slate-900">
                            {cropIcon(stop.crop)} {stop.crop}
                            {stop.buyerName ? ` — ${stop.buyerName}` : ""}
                          </h3>
                          <p className="mt-0.5 truncate text-sm text-slate-500">
                            {shortId(stop.orderId)} · 📍 {stop.location}
                            {stop.approxLocation ? " (approx)" : ""}
                            {plan?.legs?.[index]
                              ? ` · ${plan.legs[index].distanceKm} km leg`
                              : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                        <span className="font-bold text-emerald-600">
                          {currency(stop.amount)}
                        </span>

                        <Badge className={statusStyle(status)}>
                          {statusLabel(status)}
                        </Badge>

                        {["Accepted", "Confirmed"].includes(status) && (
                          <Button
                            disabled={busyId === stop.orderId}
                            onClick={() => updateStatus(stop.orderId, "In Transit")}
                          >
                            {busyId === stop.orderId ? "Working…" : "🚚 Start"}
                          </Button>
                        )}

                        {status === "In Transit" && (
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
