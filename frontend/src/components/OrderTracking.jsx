import { useEffect, useRef, useState } from "react";
import DeliveryMap, { MapLegend } from "./DeliveryMap";
import DeliveryPartnerCard from "./DeliveryPartnerCard";
import { Badge, Spinner } from "./ui";
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

  if (loading) return <Spinner label="Locating your order…" />;

  if (error) {
    return (
      <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
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

  const waypoints = [
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

  return (
    <div className="space-y-4">
      {/* Headline */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-600">
            {tracking.status === "Delivered"
              ? "DELIVERED"
              : tracking.hasLiveLocation
                ? "LIVE TRACKING"
                : "ORDER JOURNEY"}
          </p>
          <h4 className="mt-0.5 font-bold text-slate-900">
            {tracking.status === "Delivered"
              ? "🏠 Arrived at your address"
              : tracking.status === "In Transit"
                ? "🚚 On the way to you"
                : "📦 Preparing your order"}
          </h4>
          <p className="mt-0.5 text-xs text-slate-500">
            {pickup.place} → {dropoff.place}
          </p>
        </div>

        {tracking.status !== "Delivered" && (
          <div className="text-right">
            <Badge className="bg-indigo-100 text-indigo-700">
              {tracking.remainingKm} km away
            </Badge>
            <p className="mt-1 text-xs text-slate-500">
              ~{formatDuration(tracking.etaMinutes)} away
            </p>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-700"
            style={{ width: `${Math.max(3, progressPct)}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
          <span>🌾 {pickup.place}</span>
          <span>{progressPct}%</span>
          <span>🏠 {dropoff.place}</span>
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

      {driver?.updatedAt && (
        <p className="text-xs text-slate-500">
          ● Driver position updated {formatDate(driver.updatedAt)}
        </p>
      )}

      {!tracking.hasLiveLocation && tracking.status === "In Transit" && (
        <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          Your driver has not shared a live position yet, so the route shown is
          the planned one.
        </p>
      )}

      {tracking.approximate && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          ⚠️ We could not pin one of these places exactly, so its marker is
          approximate. The delivery address on the order is what the driver uses.
        </p>
      )}

      {/* Stage timeline */}
      <ol className="space-y-0">
        {stages.map((stage, index) => {
          const last = index === stages.length - 1;
          return (
            <li key={stage.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    stage.done
                      ? "bg-emerald-500 text-white"
                      : stage.current
                        ? "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {stage.done ? "✓" : index + 1}
                </span>
                {!last && (
                  <span
                    className={`w-0.5 flex-1 ${
                      stage.done ? "bg-emerald-400" : "bg-slate-200"
                    }`}
                    style={{ minHeight: "18px" }}
                  />
                )}
              </div>

              <div className={`pb-4 ${last ? "pb-0" : ""}`}>
                <p
                  className={`text-sm font-semibold ${
                    stage.done ? "text-slate-900" : "text-slate-400"
                  }`}
                >
                  {stage.label}
                </p>
                {stage.at && (
                  <p className="text-xs text-slate-400">{formatDate(stage.at)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
