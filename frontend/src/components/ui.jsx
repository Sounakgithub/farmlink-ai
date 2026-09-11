import { useEffect, useRef, useState } from "react";
import { useReveal, prefersReducedMotion } from "../lib/useReveal";

/**
 * FarmLink AI — shared building blocks.
 *
 * Every export that existed before is still here with the same signature, so
 * no calling page had to change to adopt the new look. What changed is what
 * they render: real depth, real states (loading / empty / error / success) and
 * motion that is fast enough to feel like feedback rather than decoration.
 */

/* ===========================================================================
   Motion helpers
   =========================================================================== */

/** Wraps children in a scroll-revealed block. */
export function Reveal({ children, className = "", delay = 0, as: Tag = "div" }) {
  const ref = useReveal();
  return (
    <Tag
      ref={ref}
      className={`fl-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * A number that counts up to its value once, then tracks it directly.
 *
 * Respects prefers-reduced-motion by landing on the final value immediately -
 * an animated number is decoration, the number itself is the information.
 */
export function CountUp({ value, duration = 900, format = (n) => n, className = "" }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return undefined;

    let raf;

    // Land on the value immediately when motion is unwelcome - the number is
    // the information, the animation is only decoration. Scheduled rather
    // than set inline so it never cascades a render from inside the effect.
    if (prefersReducedMotion() || duration <= 0) {
      raf = requestAnimationFrame(() => {
        setShown(target);
        fromRef.current = target;
      });
      return () => cancelAnimationFrame(raf);
    }

    const started = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      // easeOutCubic - fast start, gentle landing
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return <span className={`fl-numeric ${className}`}>{format(shown)}</span>;
}

/* ===========================================================================
   Loading
   =========================================================================== */

export function Spinner({ label = "Loading…", className = "" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-4 py-16 ${className}`}
    >
      <span className="relative flex h-10 w-10">
        <span className="absolute inset-0 rounded-full border-2 border-brand-100" />
        <span className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-t-brand-600" />
      </span>
      <span className="text-sm text-ink-soft">{label}</span>
    </div>
  );
}

/** A single shimmering placeholder block. */
export function Skeleton({ className = "" }) {
  return <div className={`fl-skeleton ${className}`} aria-hidden="true" />;
}

/** Card-shaped placeholders, for grids that are about to fill with cards. */
export function SkeletonCards({ count = 4, className = "" }) {
  return (
    <div
      className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="fl-card p-5">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="mt-4 h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-3 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Row-shaped placeholders, for lists and tables. */
export function SkeletonRows({ count = 4, className = "" }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="fl-card flex items-center gap-4 p-4">
          <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="mt-2 h-3 w-1/4" />
          </div>
          <Skeleton className="h-7 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ===========================================================================
   Surfaces
   =========================================================================== */

/**
 * The standard surface. `interactive` adds hover lift — use it only where the
 * whole card is genuinely clickable, so hover keeps meaning something.
 */
export function Card({
  as: Tag = "div",
  interactive = false,
  className = "",
  children,
  ...props
}) {
  return (
    <Tag
      className={`fl-card ${interactive ? "fl-card-interactive" : ""} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Section heading with an optional eyebrow and trailing action. */
export function SectionHeader({ eyebrow, title, description, action, className = "" }) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="fl-eyebrow text-brand-700">{eyebrow}</p>
        )}
        <h2 className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ===========================================================================
   Data display
   =========================================================================== */

const STAT_TONES = {
  emerald: {
    chip: "bg-brand-50 text-brand-700 ring-brand-100",
    bar: "bg-brand-500",
  },
  blue: { chip: "bg-sky-50 text-sky-700 ring-sky-100", bar: "bg-sky-500" },
  amber: {
    chip: "bg-harvest-50 text-harvest-700 ring-harvest-100",
    bar: "bg-harvest-500",
  },
  purple: {
    chip: "bg-violet-50 text-violet-700 ring-violet-100",
    bar: "bg-violet-500",
  },
};

/**
 * A headline number.
 *
 * Same props as before ({ icon, label, value, hint, tone }) plus optional
 * `trend` (a signed percentage) and `series` (numbers, drawn as a sparkline).
 * A numeric value counts up on mount; anything else renders as given.
 */
export function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "emerald",
  trend,
  series,
  className = "",
}) {
  const palette = STAT_TONES[tone] || STAT_TONES.emerald;
  const numeric = typeof value === "number";

  return (
    <Card className={`group relative overflow-hidden p-5 ${className}`}>
      {/* A whisper of tone that strengthens on hover. */}
      <div
        className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-[0.07] blur-2xl transition-opacity duration-300 group-hover:opacity-20 ${palette.bar}`}
      />

      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ring-1 ${palette.chip}`}
        >
          {icon}
        </span>

        {typeof trend === "number" && (
          <span
            className={`fl-numeric rounded-full px-2 py-0.5 text-xs font-bold ${
              trend >= 0
                ? "bg-brand-50 text-brand-700"
                : "bg-rose-50 text-rose-600"
            }`}
          >
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
          </span>
        )}
      </div>

      <p className="mt-4 text-sm text-ink-soft">{label}</p>

      <div className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        {numeric ? <CountUp value={value} format={(n) => Math.round(n).toLocaleString("en-IN")} /> : value}
      </div>

      {hint && <p className="mt-2 text-xs text-ink-faint">{hint}</p>}

      {Array.isArray(series) && series.length > 1 && (
        <Sparkline data={series} className={`mt-4 ${palette.bar}`} />
      )}
    </Card>
  );
}

/** A tiny inline bar chart. Pure SVG — no charting dependency. */
export function Sparkline({ data = [], className = "", height = 32 }) {
  const values = data.map((n) => Number(n) || 0);
  const max = Math.max(...values, 1);

  return (
    <div
      className={`flex items-end gap-1 ${className.replace(/bg-\S+/g, "")}`}
      style={{ height }}
      aria-hidden="true"
    >
      {values.map((value, index) => (
        <span
          key={index}
          className={`flex-1 origin-bottom rounded-sm opacity-70 ${
            className.match(/bg-\S+/)?.[0] || "bg-brand-500"
          }`}
          style={{
            height: `${Math.max(6, (value / max) * 100)}%`,
            animation: `fl-grow-bar 0.5s var(--ease-out-soft) both`,
            animationDelay: `${index * 40}ms`,
          }}
        />
      ))}
    </div>
  );
}

const BADGE_TONES = {
  brand: "bg-brand-50 text-brand-700 ring-1 ring-brand-100",
  neutral: "bg-canvas text-ink-soft ring-1 ring-line",
  amber: "bg-harvest-50 text-harvest-700 ring-1 ring-harvest-100",
  rose: "bg-rose-50 text-rose-600 ring-1 ring-rose-100",
  sky: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
  dark: "bg-soil-900 text-white ring-1 ring-white/10",
};

export function Badge({ children, tone, className = "", pulse = false }) {
  // `className` still wins, so every existing colour-by-className call works.
  const base = tone ? BADGE_TONES[tone] || BADGE_TONES.neutral : "";
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${base} ${className}`}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

/* ===========================================================================
   States: empty / error / success
   =========================================================================== */

export function EmptyState({ icon = "🌱", title, description, action, className = "" }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center ${className}`}
    >
      {/* Soft field glow so an empty state still feels designed. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-brand-50/70 to-transparent" />

      <div className="relative">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-3xl ring-1 ring-brand-100">
          {icon}
        </span>
        <h3 className="mt-5 text-lg font-bold text-ink">{title}</h3>
        {description && (
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
            {description}
          </p>
        )}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ message, onRetry, className = "" }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={`animate-fade-up flex flex-col gap-3 rounded-2xl border border-harvest-300/60 bg-harvest-50 p-4 text-sm text-harvest-700 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <span className="flex items-start gap-2.5">
        <span className="mt-px shrink-0 text-base">⚠️</span>
        <span>{message}</span>
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="w-fit shrink-0 rounded-lg bg-harvest-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-harvest-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** The tick that draws itself when something important succeeds. */
export function SuccessTick({ size = 56, className = "" }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-brand-50 ring-1 ring-brand-200 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none">
        <path
          d="M4 12.5l5 5L20 6.5"
          stroke="var(--color-brand-600)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 30,
            strokeDashoffset: 30,
            animation: "fl-draw-check 0.5s var(--ease-out-soft) 0.1s forwards",
          }}
        />
      </svg>
    </span>
  );
}

/* ===========================================================================
   Controls
   =========================================================================== */

export function Button({
  as: Tag = "button",
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}) {
  const variants = {
    primary:
      "bg-brand-600 text-white shadow-[0_1px_2px_rgba(9,20,15,.12),0_6px_18px_-6px_rgba(22,163,74,.55)] hover:bg-brand-700 hover:shadow-[0_2px_4px_rgba(9,20,15,.14),0_12px_26px_-8px_rgba(22,163,74,.6)] disabled:bg-brand-300 disabled:shadow-none",
    secondary:
      "bg-canvas text-ink ring-1 ring-line hover:bg-white hover:ring-line-strong disabled:text-ink-faint",
    danger:
      "bg-rose-50 text-rose-600 ring-1 ring-rose-100 hover:bg-rose-100 disabled:text-rose-300",
    outline:
      "bg-surface text-ink ring-1 ring-line hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800 disabled:text-ink-faint",
    ghost: "text-ink-soft hover:bg-canvas hover:text-ink disabled:text-ink-faint",
    dark: "bg-soil-900 text-white hover:bg-soil-800 disabled:bg-soil-700",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5",
    md: "px-4 py-2.5 text-sm rounded-xl gap-2",
    lg: "px-6 py-3.5 text-base rounded-xl gap-2.5",
  };

  return (
    <Tag
      className={`relative inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${
        sizes[size] || sizes.md
      } ${variants[variant] || variants.primary} ${className}`}
      disabled={Tag === "button" ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-current border-t-transparent opacity-80"
          aria-hidden="true"
        />
      )}
      {children}
    </Tag>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-rose-600">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  "mt-2 w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm text-ink outline-none transition duration-200 placeholder:text-ink-faint hover:border-line-strong focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12";

/** Pill switcher for small, mutually-exclusive choices. */
export function Segmented({ options = [], value, onChange, className = "" }) {
  return (
    <div
      role="tablist"
      className={`inline-flex rounded-xl bg-canvas p-1 ring-1 ring-line ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(option.value)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
              active
                ? "bg-surface text-ink shadow-sm"
                : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ===========================================================================
   Overlays
   =========================================================================== */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = "max-w-2xl",
}) {
  // Close on Escape, and stop the page behind from scrolling.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[900] flex items-end justify-center bg-soil-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`animate-scale-in max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface p-6 shadow-[var(--shadow-pop)] sm:rounded-3xl ${maxWidth}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-ink-soft">{description}</p>
            )}
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full bg-canvas px-3 py-2 text-sm text-ink-soft transition hover:bg-line hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onCancel?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[950] flex items-center justify-center bg-soil-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="animate-scale-in w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-pop)]">
        <span
          className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-xl ${
            tone === "danger"
              ? "bg-rose-50 text-rose-600 ring-1 ring-rose-100"
              : "bg-brand-50 text-brand-700 ring-1 ring-brand-100"
          }`}
        >
          {tone === "danger" ? "!" : "?"}
        </span>

        <h3 className="mt-4 text-lg font-bold text-ink">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{message}</p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>

          <Button
            className={`flex-1 ${
              tone === "danger"
                ? "bg-rose-600 shadow-none hover:bg-rose-700 disabled:bg-rose-300"
                : ""
            }`}
            onClick={onConfirm}
            loading={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
