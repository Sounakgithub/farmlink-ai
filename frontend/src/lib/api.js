// Single place that knows how to talk to the two backends.

export const API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

export const ML_BASE =
  import.meta.env.VITE_ML_BASE || "http://localhost:8000";

export const TOKEN_KEY = "farmlink_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked - session just won't persist */
  }
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

// AuthContext registers here so an expired token logs the user out everywhere.
let onUnauthorised = null;
export function setUnauthorisedHandler(fn) {
  onUnauthorised = fn;
}

async function request(method, path, { body, auth = true, base = API_BASE, signal } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();

  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(base + path, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(
      "Cannot reach the server. Is it running?",
      0,
      null
    );
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    if (response.status === 401 && auth && onUnauthorised) onUnauthorised();
    throw new ApiError(
      (data && (data.message || data.error)) || `Request failed (${response.status})`,
      response.status,
      data
    );
  }

  return data;
}

export const api = {
  get: (path, opts) => request("GET", path, opts),
  post: (path, body, opts) => request("POST", path, { ...opts, body }),
  patch: (path, body, opts) => request("PATCH", path, { ...opts, body }),
  put: (path, body, opts) => request("PUT", path, { ...opts, body }),
  delete: (path, opts) => request("DELETE", path, opts),
};

// ---------------------------------------------------------------------------
// Operations: delivered-price quotes, escrow, quality inspection
// ---------------------------------------------------------------------------
export const operations = {
  // Checkout preview: tier prices, road distance, delivery fee. Creates nothing.
  quote: (items, deliveryAddress, { signal } = {}) =>
    request("POST", "/orders/quote", { body: { items, deliveryAddress }, signal }),

  // Inspections, settlement, carrier and the ledger rows this viewer may see.
  forOrder: (orderId) => request("GET", `/orders/${orderId}/operations`),

  inspectionPolicy: () => request("GET", "/inspections/policy"),

  // The collecting driver inspects at the farm gate, then collects in one step.
  collectWithInspection: (orderId, inspection) =>
    request("PATCH", `/orders/${orderId}/status`, {
      body: { status: "In Transit", inspection },
    }),

  confirmDelivery: (orderId, report) =>
    request("POST", `/inspections/order/${orderId}/delivery`, { body: report }),

  farmerQuality: () => request("GET", "/inspections/farmer/me"),

  optimalRoute: (from, to, weightKg) =>
    request("POST", "/routes/optimal", { body: { from, to, weightKg } }),
};

// ---------------------------------------------------------------------------
// Logistics companies and their drivers
// ---------------------------------------------------------------------------
export const logistics = {
  myCompany: () => request("GET", "/logistics/provider/me"),
  saveCompany: (profile) => request("PUT", "/logistics/provider/me", { body: profile }),
  assignments: (status) =>
    request("GET", `/logistics/assignments${status ? `?status=${status}` : ""}`),
  accept: (assignmentId, driverId) =>
    request("POST", `/logistics/assignments/${assignmentId}/accept`, { body: { driverId } }),
  reject: (assignmentId, reason) =>
    request("POST", `/logistics/assignments/${assignmentId}/reject`, { body: { reason } }),
  drivers: () => request("GET", "/logistics/drivers"),
  removeDriver: (driverId) => request("DELETE", `/logistics/drivers/${driverId}`),

  // Driver side
  join: (code) => request("POST", "/logistics/join", { body: { code } }),
  leave: () => request("POST", "/logistics/leave"),
};

// ---------------------------------------------------------------------------
// Wholesale (verified business buyers)
// ---------------------------------------------------------------------------
export const b2b = {
  account: () => request("GET", "/b2b/account"),
  requestAccount: (companyName, gstin) =>
    request("POST", "/b2b/account", { body: { companyName, gstin } }),
  quote: (items, deliveryAddress) =>
    request("POST", "/b2b/quote", { body: { items, deliveryAddress } }),
  placeOrder: (payload) => request("POST", "/b2b/orders", { body: payload }),
  invoices: () => request("GET", "/b2b/invoices"),
  payInvoice: (orderId) => request("POST", `/b2b/invoices/${orderId}/pay`),
  apiKeys: () => request("GET", "/b2b/api-keys"),
  createApiKey: (payload) => request("POST", "/b2b/api-keys", { body: payload }),
  revokeApiKey: (id) => request("DELETE", `/b2b/api-keys/${id}`),
};

// ---------------------------------------------------------------------------
// Platform administration
// ---------------------------------------------------------------------------
export const admin = {
  overview: () => request("GET", "/admin/overview"),
  settings: () => request("GET", "/admin/settings"),
  saveSettings: (patch) => request("PUT", "/admin/settings", { body: patch }),
  disputes: () => request("GET", "/admin/disputes"),
  resolveDispute: (orderId, decision) =>
    request("POST", `/admin/disputes/${orderId}/resolve`, { body: decision }),
  businessAccounts: (status = "requested") =>
    request("GET", `/admin/business-accounts?status=${status}`),
  decideBusiness: (userId, decision) =>
    request("POST", `/admin/business-accounts/${userId}`, { body: decision }),
  providers: () => request("GET", "/admin/providers"),
  moderateProvider: (id, patch) => request("PATCH", `/admin/providers/${id}`, { body: patch }),
  audit: ({ action = "", entityId = "", page = 1, limit = 50 } = {}) =>
    request(
      "GET",
      `/admin/audit?page=${page}&limit=${limit}` +
        (action ? `&action=${encodeURIComponent(action)}` : "") +
        (entityId ? `&entityId=${encodeURIComponent(entityId)}` : "")
    ),
  ledger: (orderId) => request("GET", `/admin/ledger/${orderId}`),
  pairs: () => request("GET", "/admin/pairs"),
  runSweeps: () => request("POST", "/admin/sweeps/run"),
};

// ---------------------------------------------------------------------------
// AI farmer <-> buyer matching (backend, JWT-protected)
// ---------------------------------------------------------------------------
export const matching = {
  // Farmer: the buyers most likely to want one of their own listings.
  buyersForProduct: (productId, { limit = 10, signal } = {}) =>
    request("GET", `/matching/product/${productId}/buyers?limit=${limit}`, { signal }),

  // Buyer: the crops and farmers that suit them.
  recommendations: ({ limit = 10, signal } = {}) =>
    request("GET", `/matching/buyer/recommendations?limit=${limit}`, { signal }),

  // Preferences are saved through the existing profile endpoint
  // (PATCH /auth/me) via AuthContext.updateProfile - no separate resource.
};

// ---------------------------------------------------------------------------
// Fair-deal pricing: what a price means for the farmer and for the buyer
// ---------------------------------------------------------------------------
export const pricing = {
  reference: (crop, location) =>
    request(
      "GET",
      `/pricing/reference?crop=${encodeURIComponent(crop)}` +
        (location ? `&location=${encodeURIComponent(location)}` : "")
    ),

  fairDeal: (payload) => request("POST", "/pricing/fair-deal", { body: payload }),
};

// ---------------------------------------------------------------------------
// ML service (no auth, separate origin)
// ---------------------------------------------------------------------------
export const ml = {
  predictPrice: (payload) =>
    request("POST", "/predict-price", { body: payload, auth: false, base: ML_BASE }),

  forecastDemand: (payload, signal) =>
    request("POST", "/forecast-demand", {
      body: payload,
      auth: false,
      base: ML_BASE,
      signal,
    }),

  demandInsights: (payload, signal) =>
    request("POST", "/demand-insights", {
      body: payload,
      auth: false,
      base: ML_BASE,
      signal,
    }),
};
