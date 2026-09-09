// Where each role lands after logging in.
export const HOME_FOR_ROLE = {
  farmer: "/farmer",
  buyer: "/buyer",
  driver: "/driver",
};

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
