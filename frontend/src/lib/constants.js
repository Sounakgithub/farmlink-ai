// Where each role lands after logging in.
export const HOME_FOR_ROLE = {
  farmer: "/farmer",
  buyer: "/buyer",
  driver: "/driver",
  logistics: "/logistics",
  admin: "/admin",
};

// What each escrow state means, in words a buyer, farmer or carrier would use.
export const SETTLEMENT_INFO = {
  awaiting_payment: { label: "Awaiting payment", tone: "amber", hint: "Cash is collected when the order arrives." },
  invoiced: { label: "Invoiced", tone: "sky", hint: "Payable on the invoice credit terms." },
  held: { label: "Held in escrow", tone: "sky", hint: "Paid out once the buyer confirms good condition, or automatically after the release window." },
  released: { label: "Paid out", tone: "brand", hint: "The farmer and carrier have been paid." },
  refunded: { label: "Refunded", tone: "neutral", hint: "The buyer received their money back." },
  partially_refunded: { label: "Partly refunded", tone: "neutral", hint: "Settled after a dispute with a partial refund." },
  disputed: { label: "Under review", tone: "rose", hint: "Payment is frozen while FarmLink reviews the delivery report." },
  voided: { label: "Closed", tone: "neutral", hint: "The order ended before any money moved." },
};

export const INSPECTION_GRADES = [
  { value: "A", label: "A", hint: "Premium: uniform, fresh, no defects" },
  { value: "B", label: "B", hint: "Standard: minor cosmetic variation" },
  { value: "C", label: "C", hint: "Marginal: saleable but aged or uneven" },
  { value: "REJECT", label: "Reject", hint: "Unfit to ship: needs notes and a photo" },
];

export const INSPECTION_CHECKS = [
  { key: "freshness", label: "Fresh", fails: true },
  { key: "pestFree", label: "Pest-free", fails: true },
  { key: "packaging", label: "Packaging sound", fails: false },
  { key: "moistureOk", label: "Moisture normal", fails: false },
];

export const DELIVERY_CONDITIONS = [
  { value: "good", label: "Good", icon: "✓", hint: "Arrived as ordered" },
  { value: "damaged", label: "Damaged", icon: "⚠", hint: "Crushed, bruised or broken" },
  { value: "short", label: "Short", icon: "⚖", hint: "Less than was ordered" },
  { value: "spoiled", label: "Spoiled", icon: "✕", hint: "Rotten or unfit to use" },
];

export const API_SCOPES = [
  { value: "products:read", label: "Read catalogue" },
  { value: "quotes:write", label: "Request quotes" },
  { value: "orders:write", label: "Place orders" },
  { value: "orders:read", label: "Read orders" },
];

// Cities the demand-forecasting model was trained on.
export const DEMAND_LOCATIONS = [
  "Delhi",
  "Mumbai",
  "Pune",
  "Bangalore",
  "Kolkata",
  "Patna",
  "Hyderabad",
  "Chennai",
];

// Crops the ML service knows about.
export const KNOWN_CROPS = [
  "Tomato",
  "Potato",
  "Onion",
  "Carrot",
  "Spinach",
  "Cabbage",
  "Cauliflower",
  "Brinjal",
  "Peas",
  "Beans",
];

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Payment options at checkout. Anything other than COD is treated as a mock
// "instant" prepaid transaction by the backend.
export const PAYMENT_METHODS = [
  {
    value: "Cash on Delivery",
    label: "Cash on Delivery",
    icon: "💵",
    hint: "Pay the delivery partner when your order arrives",
    prepaid: false,
  },
  {
    value: "UPI",
    label: "UPI",
    icon: "📱",
    hint: "Google Pay, PhonePe, Paytm and more",
    prepaid: true,
  },
  {
    value: "Card",
    label: "Credit / Debit card",
    icon: "💳",
    hint: "Visa, Mastercard, RuPay",
    prepaid: true,
  },
  {
    value: "Net Banking",
    label: "Net banking",
    icon: "🏦",
    hint: "All major banks supported",
    prepaid: true,
  },
];
