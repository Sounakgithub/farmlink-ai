// Lightweight offline geocoder for the cities FarmLink operates in.
// Keeps the project dependency-free (no external geocoding API / key needed).

const CITY_COORDS = {
  delhi: { lat: 28.6139, lng: 77.209 },
  "new delhi": { lat: 28.6139, lng: 77.209 },
  gurgaon: { lat: 28.4595, lng: 77.0266 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
  noida: { lat: 28.5355, lng: 77.391 },
  ghaziabad: { lat: 28.6692, lng: 77.4538 },
  faridabad: { lat: 28.4089, lng: 77.3178 },
  sonipat: { lat: 28.9931, lng: 77.0151 },
  panipat: { lat: 29.3909, lng: 76.9635 },
  meerut: { lat: 28.9845, lng: 77.7064 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  pune: { lat: 18.5204, lng: 73.8567 },
  nashik: { lat: 19.9975, lng: 73.7898 },
  nagpur: { lat: 21.1458, lng: 79.0882 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  patna: { lat: 25.5941, lng: 85.1376 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  bhopal: { lat: 23.2599, lng: 77.4126 },
  indore: { lat: 22.7196, lng: 75.8577 },
};

const DEFAULT_DEPOT = { lat: 28.6139, lng: 77.209, label: "Delhi (depot)" };

/**
 * Resolve a free-text place name to coordinates.
 * Matches on exact key first, then on any city name contained in the string
 * (so "Patna, Bihar" -> Patna).
 * @returns {{lat:number, lng:number}|null}
 */
function geocode(name) {
  if (!name || typeof name !== "string") return null;
  const q = name.trim().toLowerCase();
  if (!q) return null;

  if (CITY_COORDS[q]) return { ...CITY_COORDS[q] };

  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (q.includes(city)) return { ...coords };
  }
  return null;
}

// Deterministic small offset (roughly within ~6 km) around an anchor point,
// used only as a visual fallback when a stop's location cannot be resolved.
function approxNear(anchor, seed = 1) {
  const s = Math.abs(Number(seed) || 1);
  const angle = (s * 137.508) % 360; // golden-angle spread
  const radiusKm = 2 + ((s * 2.4) % 4);
  const dLat = (radiusKm / 111) * Math.cos((angle * Math.PI) / 180);
  const dLng =
    (radiusKm / (111 * Math.cos((anchor.lat * Math.PI) / 180))) *
    Math.sin((angle * Math.PI) / 180);
  return { lat: anchor.lat + dLat, lng: anchor.lng + dLng };
}

// Stable numeric hash for a string (e.g. a Mongo ObjectId) -> jitter seed.
function hashSeed(value) {
  const str = String(value || "");
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 997 || 1;
}

module.exports = { geocode, approxNear, hashSeed, DEFAULT_DEPOT, CITY_COORDS };
