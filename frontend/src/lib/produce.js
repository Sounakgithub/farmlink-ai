/**
 * Small derivations used by the marketplace UI.
 *
 * Everything here is computed from data the app genuinely has — when a listing
 * was created, and the two city names involved. Nothing is invented: where a
 * value cannot be derived, these return null and the UI omits the row rather
 * than displaying a guess.
 *
 * The city table mirrors backend/utils/geocode.js, so a distance shown to a
 * buyer agrees with the one the delivery planner uses.
 */

const CITY_COORDS = {
  delhi: [28.6139, 77.209],
  "new delhi": [28.6139, 77.209],
  gurgaon: [28.4595, 77.0266],
  gurugram: [28.4595, 77.0266],
  noida: [28.5355, 77.391],
  ghaziabad: [28.6692, 77.4538],
  faridabad: [28.4089, 77.3178],
  sonipat: [28.9931, 77.0151],
  panipat: [29.3909, 76.9635],
  meerut: [28.9845, 77.7064],
  mumbai: [19.076, 72.8777],
  pune: [18.5204, 73.8567],
  nashik: [19.9975, 73.7898],
  nagpur: [21.1458, 79.0882],
  bangalore: [12.9716, 77.5946],
  bengaluru: [12.9716, 77.5946],
  kolkata: [22.5726, 88.3639],
  patna: [25.5941, 85.1376],
  hyderabad: [17.385, 78.4867],
  chennai: [13.0827, 80.2707],
  lucknow: [26.8467, 80.9462],
  jaipur: [26.9124, 75.7873],
  ahmedabad: [23.0225, 72.5714],
  bhopal: [23.2599, 77.4126],
  indore: [22.7196, 75.8577],
};

/** Resolve free text to coordinates, or null. Never guesses. */
function locate(name) {
  if (!name || typeof name !== "string") return null;
  const q = name.trim().toLowerCase();
  if (!q) return null;
  if (CITY_COORDS[q]) return CITY_COORDS[q];
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (q.includes(city)) return coords;
  }
  return null;
}

/**
 * Straight-line km between two place names.
 * @returns {number|null} null when either place cannot be placed on the map.
 */
export function distanceBetween(from, to) {
  const a = locate(from);
  const b = locate(to);
  if (!a || !b) return null;

  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * How recently a listing went up, expressed the way a shopper thinks about
 * produce. This is listing age — genuinely known — and never a claim about
 * the harvest date, which the app does not record.
 *
 * @returns {{label, className, listed}|null}
 */
export function freshnessFor(createdAt) {
  if (!createdAt) return null;

  const listedAt = new Date(createdAt);
  if (Number.isNaN(listedAt.getTime())) return null;

  const hours = (Date.now() - listedAt.getTime()) / 36e5;

  const listed =
    hours < 1
      ? "Just now"
      : hours < 24
        ? `${Math.round(hours)}h ago`
        : hours < 48
          ? "Yesterday"
          : `${Math.round(hours / 24)}d ago`;

  if (hours <= 24) {
    return {
      label: "Just harvested",
      className: "bg-brand-600 text-white",
      listed,
    };
  }
  if (hours <= 72) {
    return { label: "Fresh", className: "bg-brand-100 text-brand-800", listed };
  }
  if (hours <= 168) {
    return {
      label: "In season",
      className: "bg-harvest-100 text-harvest-700",
      listed,
    };
  }
  return null; // older than a week: say nothing rather than something vague
}
