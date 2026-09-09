import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../lib/api";
import { useAuth } from "./AuthContext";

const MessagesContext = createContext(null);

/**
 * Keeps a live count of unread messages for the nav badge and lets any page
 * refresh it after sending / reading a message.
 */
export function MessagesProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [unread, setUnread] = useState(0);

  // Reset the badge the moment the user signs out (render-phase, like the cart).
  const [authed, setAuthed] = useState(isAuthenticated);
  if (authed !== isAuthenticated) {
    setAuthed(isAuthenticated);
    if (!isAuthenticated) setUnread(0);
  }

  const refresh = useCallback(async () => {
    try {
      const data = await api.get("/conversations/unread-count");
      setUnread(data.count || 0);
    } catch {
      /* stay quiet - the badge just won't update */
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let alive = true;
    const tick = async () => {
      try {
        const data = await api.get("/conversations/unread-count");
        if (alive) setUnread(data.count || 0);
      } catch {
        /* ignore */
      }
    };

    tick();
    const timer = setInterval(tick, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);

  return (
    <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
  );
}

export function useMessages() {
  const context = useContext(MessagesContext);
  if (!context) {
    throw new Error("useMessages must be used inside a <MessagesProvider>");
  }
  return context;
}
