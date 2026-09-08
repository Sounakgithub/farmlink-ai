import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs an async loader on mount and exposes { data, loading, error, reload }.
 *
 * The loader is kept in a ref so the effect never re-fires when a page passes
 * a fresh inline function, and every setState happens after an await - which
 * keeps the fetch-on-mount pattern out of React's cascading-render warning.
 */
export function useAsyncData(loader, { initialData = null } = {}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Keep the latest loader without re-running the mount effect when a page
  // passes a fresh inline function on every render.
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const aliveRef = useRef(true);

  const run = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }

    try {
      const result = await loaderRef.current();
      if (!aliveRef.current) return;
      setData(result);
      setError("");
    } catch (err) {
      if (!aliveRef.current || err.name === "AbortError") return;
      setError(err.message || "Something went wrong.");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;

    // Defined inside the effect and awaited before the first setState, so the
    // initial load never updates state synchronously during the effect.
    const load = async () => {
      try {
        const result = await loaderRef.current();
        if (!aliveRef.current) return;
        setData(result);
      } catch (err) {
        if (!aliveRef.current || err.name === "AbortError") return;
        setError(err.message || "Something went wrong.");
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    };

    load();

    return () => {
      aliveRef.current = false;
    };
  }, []);

  return { data, setData, loading, error, reload: run };
}
