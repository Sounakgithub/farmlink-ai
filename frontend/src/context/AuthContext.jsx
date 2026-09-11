import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  api,
  setToken,
  getToken,
  setUnauthorisedHandler,
  TOKEN_KEY,
} from "../lib/api";
import { HOME_FOR_ROLE } from "../lib/constants";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  // An expired / rejected token anywhere in the app ends the session.
  useEffect(() => {
    setUnauthorisedHandler(() => {
      setToken(null);
      setUser(null);
    });
    return () => setUnauthorisedHandler(null);
  }, []);

  // Restore the session on boot.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const data = await api.get("/auth/me");
        if (!cancelled) setUser(data.user);
      } catch {
        if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep every open tab on the same account.
  //
  // The token lives in localStorage, which is shared across all tabs on this
  // origin - so signing in as a different account in one tab silently swaps
  // the token underneath the others. They would carry on rendering the old
  // role's pages while sending the new account's token, and the server would
  // rightly refuse the action ("a driver cannot accept an order"). Reacting to
  // the storage event keeps the session the UI believes in and the token it
  // actually sends from ever drifting apart.
  useEffect(() => {
    const onStorage = async (event) => {
      if (event.key !== TOKEN_KEY) return;

      // Signed out elsewhere.
      if (!event.newValue) {
        setUser(null);
        return;
      }
      // Signed in as somebody else elsewhere - adopt that account.
      try {
        const data = await api.get("/auth/me");
        setUser(data.user);
      } catch {
        setToken(null);
        setUser(null);
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.post("/auth/login", { email, password }, { auth: false });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const data = await api.post("/auth/register", payload, { auth: false });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const updateProfile = useCallback(async (payload) => {
    const data = await api.patch("/auth/me", payload);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      updateProfile,
      homePath: user ? HOME_FOR_ROLE[user.role] || "/login" : "/login",
    }),
    [user, loading, login, register, logout, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an <AuthProvider>");
  }
  return context;
}
