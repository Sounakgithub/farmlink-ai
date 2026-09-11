import { useEffect, useRef } from "react";

/**
 * Reveal-on-scroll.
 *
 * Returns a ref for any element carrying the `fl-reveal` class; the observer
 * adds `is-visible` as it enters the viewport and then stops watching it.
 *
 * Falls back to showing the element immediately when IntersectionObserver is
 * unavailable, so content can never get stuck invisible.
 */
export function useReveal({ threshold = 0.12, once = true } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      node.classList.add("is-visible");
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            entry.target.classList.remove("is-visible");
          }
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once]);

  return ref;
}

/** True when the visitor asked the system for less motion. */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
