// Single place that knows how to talk to the two backends.

export const API_BASE =
  import.meta.env.VITE_API_BASE || "http://localhost:5000/api";

export const ML_BASE =
  import.meta.env.VITE_ML_BASE || "http://localhost:8000";

const TOKEN_KEY = "farmlink_token";

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
  delete: (path, opts) => request("DELETE", path, opts),
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
