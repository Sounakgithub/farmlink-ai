import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";

/**
 * The shared delivery map.
 *
 * Draws a whole journey rather than a single dot: where each parcel is
 * collected (the farm), where it is going (the address the buyer gave at
 * checkout), the optimised path between them, and the driver's live position.
 *
 * Used by the driver's route view and the buyer's parcel tracking, so both
 * sides are looking at the same geometry.
 */

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------
const pin = (emoji, size = 32) =>
  L.divIcon({
    html: `<div style="font-size:${size - 8}px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">${emoji}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

const depotIcon = pin("🏬");
const driverIcon = pin("🚚", 38);
const farmIcon = pin("🌾");
const homeIcon = pin("🏠");

// Numbered teardrop showing the visiting order. Green = collect, blue = deliver.
const sequenceIcon = (n, type, done) =>
  L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    html: `<div style="
      background:${done ? "#94a3b8" : type === "pickup" ? "#059669" : "#2563eb"};
      color:#fff;font-weight:700;font-size:12px;
      width:24px;height:24px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">
      <span style="transform:rotate(45deg)">${n}</span>
    </div>`,
  });

// ---------------------------------------------------------------------------
// Keep every point of the journey in view, however far apart they are.
// ---------------------------------------------------------------------------
function FitBounds({ points }) {
  const map = useMap();

  useEffect(() => {
    const valid = (points || []).filter(
      (p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])
    );
    if (valid.length === 0) return;

    if (valid.length === 1) {
      map.setView(valid[0], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(valid), { padding: [40, 40], maxZoom: 14 });
  }, [map, points]);

  return null;
}

/**
 * props:
 *   stops        [{ lat, lng, type:"pickup"|"dropoff", sequence, label, place, done? }]
 *   waypoints    [{ lat, lng }]  the optimised path, in travel order
 *   start        { lat, lng, label }            optional depot marker
 *   driver       { lat, lng, updatedAt }        optional live position
 *   travelled    [{ lat, lng }]  path already covered - drawn solid
 *   height       tailwind height classes
 */
export default function DeliveryMap({
  stops = [],
  waypoints = [],
  start = null,
  driver = null,
  travelled = null,
  height = "h-72 sm:h-96",
  children,
}) {
  const path = useMemo(
    () =>
      (waypoints || [])
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
        .map((p) => [p.lat, p.lng]),
    [waypoints]
  );

  const travelledPath = useMemo(
    () =>
      (travelled || [])
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng))
        .map((p) => [p.lat, p.lng]),
    [travelled]
  );

  const allPoints = useMemo(() => {
    const points = [...path];
    for (const stop of stops) {
      if (Number.isFinite(stop?.lat) && Number.isFinite(stop?.lng)) {
        points.push([stop.lat, stop.lng]);
      }
    }
    if (start && Number.isFinite(start.lat)) points.push([start.lat, start.lng]);
    if (driver && Number.isFinite(driver.lat)) points.push([driver.lat, driver.lng]);
    return points;
  }, [path, stops, start, driver]);

  const centre = allPoints[0] || [28.6139, 77.209];

  return (
    <div className={`overflow-hidden rounded-xl border border-line ${height}`}>
      <MapContainer
        center={centre}
        zoom={11}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBounds points={allPoints} />

        {/* Planned route. Dashed, because a straight line between stops is an
            estimate of the journey, not a surveyed road path. */}
        {path.length > 1 && (
          <Polyline
            positions={path}
            pathOptions={{
              color: "#059669",
              weight: 4,
              opacity: 0.75,
              dashArray: "8 8",
            }}
          />
        )}

        {/* The part already covered, drawn solid on top. */}
        {travelledPath.length > 1 && (
          <Polyline
            positions={travelledPath}
            pathOptions={{ color: "#059669", weight: 5, opacity: 0.95 }}
          />
        )}

        {start && Number.isFinite(start.lat) && (
          <Marker position={[start.lat, start.lng]} icon={depotIcon}>
            <Popup>🏬 {start.label || "Start"}</Popup>
          </Marker>
        )}

        {stops
          .filter((s) => Number.isFinite(s?.lat) && Number.isFinite(s?.lng))
          .map((stop, index) => (
            <Marker
              key={`${stop.type}-${stop.orderId || index}-${stop.sequence ?? index}`}
              position={[stop.lat, stop.lng]}
              icon={
                stop.sequence
                  ? sequenceIcon(stop.sequence, stop.type, stop.done)
                  : stop.type === "pickup"
                    ? farmIcon
                    : homeIcon
              }
            >
              <Popup>
                <strong>
                  {stop.type === "pickup" ? "🌾 Collect" : "🏠 Deliver"}
                  {stop.sequence ? ` · stop ${stop.sequence}` : ""}
                </strong>
                <br />
                {stop.crop && (
                  <>
                    {stop.crop}
                    <br />
                  </>
                )}
                📍 {stop.place || stop.label}
                {stop.approxLocation ? " (approximate)" : ""}
                {stop.buyerName && stop.type === "dropoff" && (
                  <>
                    <br />
                    For {stop.buyerName}
                  </>
                )}
                {stop.etaMinutes != null && (
                  <>
                    <br />~{stop.etaMinutes} min in
                  </>
                )}
              </Popup>
            </Marker>
          ))}

        {driver && Number.isFinite(driver.lat) && (
          <Marker position={[driver.lat, driver.lng]} icon={driverIcon}>
            <Popup>🚚 Driver is here</Popup>
          </Marker>
        )}

        {children}
      </MapContainer>
    </div>
  );
}

/** Small legend so the pin colours are not a guessing game. */
export function MapLegend({ approximate = false }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-600" />
        Collect from farm
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-600" />
        Deliver to buyer
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0.5 w-5 bg-brand-600" />
        Planned path
      </span>
      {approximate && (
        <span className="text-amber-600">⚠️ some points are approximate</span>
      )}
    </div>
  );
}
