import { useEffect, useRef, useState } from "react";
import DeliveryMap, { MapLegend } from "./DeliveryMap";
import DeliveryPartnerCard from "./DeliveryPartnerCard";
import { Badge, Card, Skeleton } from "./ui";
import { api } from "../lib/api";
import { formatDate, formatDuration } from "../lib/format";

/**
 * Parcel tracking for one order — the view a buyer opens to answer
 * "where is my order?".
 *
 * Shows the whole journey rather than a lone dot: the farm it is collected
 * from, the address the buyer gave at checkout, the path between them, the
 * driver's live position, and the stages the parcel has passed through.
 *
 * Polls while the order is moving and stops as soon as it is delivered, so an
 * idle tab is not hammering the API.
 */

const POLL_MS = 15000;

export default function OrderTracking({ orderId, status, compact = false }) {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    const load = async () => {
      try {
        const data = await api.get(`/orders/${orderId}/tracking`);
        if (!aliveRef.current) return;
        setTracking(data);
        setError("");
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err.message || "Could not load tracking.");
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    };

    load();

    // Only keep polling while the parcel can still move.
    const moving = ["Accepted", "Confirmed", "In Transit"].includes(status);
    const timer = moving ? setInterval(load, POLL_MS) : null;

    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [orderId, status]);

  // A shaped skeleton rather than a spinner, so the layout never jumps.
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2.5 h-6 w-56" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
          <Skeleton className="h-16 w-28 rounded-2xl" />
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-xl bg-harvest-50 p-3 text-xs text-harvest-700 ring-1 ring-harvest-100">
        ⚠️ {error}
      </p>
    );
  }

  if (!tracking) return null;

  const { pickup, dropoff, driver, stages, progressPct } = tracking;

  // Farm and destination always shown; the driver is drawn only when live.
  const stops = [
    { ...pickup, type: "pickup", crop: tracking.crop },
    { ...dropoff, type: "dropoff" },
  ];

  // The real road when a routing provider answered; otherwise the straight
  // farm -> driver -> door line the map always drew.
  const roadLine =
    tracking.road && !tracking.road.approximate && tracking.road.geometry?.length > 2
      ? tracking.road.geometry.map(([lat, lng]) => ({ lat, lng }))
      : null;

  const waypoints = roadLine || [
    { lat: pickup.lat, lng: pickup.lng },
    ...(driver ? [{ lat: driver.lat, lng: driver.lng }] : []),
    { lat: dropoff.lat, lng: dropoff.lng },
  ];

  // Solid line for ground already covered.
  const travelled = driver
    ? [
        { lat: pickup.lat, lng: pickup.lng },
        { lat: driver.lat, lng: driver.lng },
      ]
    : null;

  const delivered = tracking.status === "Delivered";

  return (
    <div className="space-y-5">
      {/* ---- headline ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="fl-eyebrow flex items-center gap-2 text-brand-700">
            {!delivered && tracking.hasLiveLocation && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
            )}
            {delivered
              ? "Delivered"
              : tracking.hasLiveLocation
                ? "Live tracking"
                : "Order journey"}
          </p>

          <h4 className="mt-1.5 text-xl font-bold tracking-tight text-ink">
            {delivered
              ? "Arrived at your address"
              : tracking.status === "In Transit"
                ? "On the way to you"
                : "Preparing your order"}
          </h4>

          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
            <span className="font-semibold text-ink">{pickup.place}</span>
            <span className="text-ink-faint">→</span>
            <span className="font-semibold text-ink">{dropoff.place}</span>
          </p>
        </div>

        {!delivered && (
          <div className="shrink-0 rounded-2xl bg-canvas px-4 py-3 text-right ring-1 ring-line">
            <p className="fl-numeric text-xl font-bold text-ink">
              ~{formatDuration(tracking.etaMinutes)}
            </p>
            <p className="fl-numeric mt-0.5 text-xs text-ink-soft">
              {tracking.remainingKm} km to go
            </p>
          </div>
        )}
      </div>

      {/* ---- progress rail ---- */}
      <div>
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-[width] duration-1000 ease-out"
            style={{ width: `${Math.max(4, progressPct)}%` }}
          />
        </div>

        {/* The leading edge, sitting on the rail while the parcel moves. */}
        {!delivered && progressPct > 4 && (
          <div className="relative -mt-[13px] mb-[3px] h-0">
            <span
              className="absolute h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white bg-brand-500 shadow-sm transition-[left] duration-1000 ease-out"
              style={{ left: `${Math.max(4, progressPct)}%` }}
            />
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1 text-ink-faint">🌾 Farm</span>
          <span className="fl-numeric font-bold text-brand-700">{progressPct}%</span>
          <span className="flex items-center gap-1 text-ink-faint">🏠 You</span>
        </div>
      </div>

      {/* Who is bringing it */}
      <DeliveryPartnerCard
        partner={tracking.deliveryPartner}
        orderId={orderId}
        status={tracking.status}
      />

      {/* Map */}
      <DeliveryMap
        stops={stops}
        waypoints={waypoints}
        driver={driver}
        travelled={travelled}
        height={compact ? "h-56" : "h-64 sm:h-80"}
      />
      <MapLegend approximate={tracking.approximate} />

      {tracking.road && (
        <p className="fl-numeric text-xs text-ink-faint">
          {tracking.road.approximate
            ? `≈ ${tracking.road.distanceKm} km (straight-line estimate)`
            : `${tracking.road.distanceKm} km by road · ~${formatDuration(tracking.road.durationMin)} drive`}
          {tracking.logistics?.providerName ? ` · carried by ${tracking.logistics.providerName}` : ""}
          {tracking.inspection?.pickup?.result === "passed"
            ? ` · passed pickup inspection (grade ${tracking.inspection.pickup.grade})`
            : ""}
        </p>
      )}

      {driver?.updatedAt && (
        <p className="flex items-center gap-1.5 text-xs text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          Driver position updated {formatDate(driver.updatedAt)}
        </p>
      )}

      {!tracking.hasLiveLocation && tracking.status === "In Transit" && (
        <p className="rounded-xl bg-canvas p-3 text-xs text-ink-soft ring-1 ring-line">
          Your driver has not shared a live position yet, so the route shown is
          the planned one.
        </p>
      )}

      {tracking.approximate && (
        <p className="rounded-xl bg-harvest-50 p-3 text-xs text-harvest-700 ring-1 ring-harvest-100">
          ⚠️ We could not pin one of these places exactly, so its marker is
          approximate. The delivery address on the order is what the driver uses.
        </p>
      )}

      {/* ---- stage timeline ---- */}
      <Card className="p-5">
        <p className="fl-eyebrow text-ink-faint">Delivery timeline</p>

        <ol className="mt-4">
          {stages.map((stage, index) => {
            const last = index === stages.length - 1;
            const active = stage.current && !stage.done;

            return (
              <li key={stage.key} className="flex gap-4">
                {/* rail */}
                <div className="flex flex-col items-center">
                  <span
                    className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors duration-300 ${
                      stage.done
                        ? "bg-brand-600 text-white"
                        : active
                          ? "animate-pulse-ring bg-brand-50 text-brand-700 ring-2 ring-brand-500"
                          : "bg-canvas text-ink-faint ring-1 ring-line"
                    }`}
                  >
                    {stage.done ? "✓" : index + 1}
                  </span>

                  {!last && (
                    <span
                      className={`w-0.5 flex-1 rounded-full transition-colors duration-500 ${
                        stage.done ? "bg-brand-400" : "bg-line"
                      }`}
                      style={{ minHeight: "28px" }}
                    />
                  )}
                </div>

                {/* copy */}
                <div className={last ? "pb-0 pt-1" : "pb-6 pt-1"}>
                  <p
                    className={`text-sm font-bold transition-colors duration-300 ${
                      stage.done || active ? "text-ink" : "text-ink-faint"
                    }`}
                  >
                    {stage.label}
                  </p>

                  {active && (
                    <Badge tone="brand" pulse className="mt-1.5">
                      Happening now
                    </Badge>
                  )}

                  {stage.at && (
                    <p className="mt-1 text-xs text-ink-faint">
                      {formatDate(stage.at)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
