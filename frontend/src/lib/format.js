export const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN")}`;

export const kg = (value) => `${Number(value || 0).toLocaleString("en-IN")} kg`;

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

const CROP_ICONS = [
  ["tomato", "🍅"],
  ["onion", "🧅"],
  ["potato", "🥔"],
  ["carrot", "🥕"],
  ["spinach", "🥬"],
  ["cabbage", "🥬"],
  ["cauliflower", "🥦"],
  ["broccoli", "🥦"],
  ["brinjal", "🍆"],
  ["eggplant", "🍆"],
  ["pea", "🫛"],
  ["bean", "🫘"],
  ["corn", "🌽"],
  ["maize", "🌽"],
  ["chilli", "🌶️"],
  ["pepper", "🌶️"],
  ["rice", "🌾"],
  ["wheat", "🌾"],
  ["mango", "🥭"],
  ["banana", "🍌"],
  ["apple", "🍎"],
  ["grape", "🍇"],
  ["cucumber", "🥒"],
  ["garlic", "🧄"],
  ["mushroom", "🍄"],
  ["coconut", "🥥"],
  ["lemon", "🍋"],
  ["orange", "🍊"],
];

export function cropIcon(name = "") {
  const crop = String(name).toLowerCase();
  const hit = CROP_ICONS.find(([key]) => crop.includes(key));
  return hit ? hit[1] : "🌱";
}

export function statusStyle(status) {
  switch (status) {
    case "Delivered":
      return "bg-green-100 text-green-700";
    case "Accepted":
    case "Confirmed":
      return "bg-blue-100 text-blue-700";
    case "In Transit":
      return "bg-indigo-100 text-indigo-700";
    case "Cancelled":
    case "Rejected":
      return "bg-red-100 text-red-700";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

export function statusLabel(status) {
  switch (status) {
    case "Delivered":
      return "✓ Delivered";
    case "In Transit":
      return "🚚 In Transit";
    case "Accepted":
    case "Confirmed":
      return "✓ Accepted";
    case "Rejected":
      return "✕ Rejected";
    case "Cancelled":
      return "✕ Cancelled";
    default:
      return "⏳ Pending";
  }
}

export const shortId = (id) => `#${String(id || "").slice(-6).toUpperCase()}`;
