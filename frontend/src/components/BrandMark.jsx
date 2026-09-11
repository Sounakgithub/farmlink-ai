/**
 * The FarmLink AI mark.
 *
 * A sprout whose leaves double as a network node-and-link: the whole product
 * in one glyph — something growing, connected directly to something else.
 * Drawn as inline SVG so it stays crisp at any size, inherits currentColor
 * where useful, and costs no extra request.
 */
export default function BrandMark({ size = 36, className = "", animated = false }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" width={size} height={size} fill="none">
        <defs>
          <linearGradient id="fl-mark-leaf" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-400)" />
            <stop offset="100%" stopColor="var(--color-brand-600)" />
          </linearGradient>
          <linearGradient id="fl-mark-shell" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand-700)" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Rounded tile */}
        <rect
          x="0.5"
          y="0.5"
          width="39"
          height="39"
          rx="11"
          fill="url(#fl-mark-shell)"
          stroke="var(--color-brand-500)"
          strokeOpacity="0.28"
        />

        {/* Stem */}
        <path
          d="M20 30.5V17.5"
          stroke="url(#fl-mark-leaf)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />

        {/* Left leaf / node */}
        <path
          d="M19.4 20.2c-3.6.5-6.2-1.1-7.4-4.6 3.7-1.1 6.6 0 7.9 3.2"
          fill="url(#fl-mark-leaf)"
        />

        {/* Right leaf / node */}
        <path
          d="M20.6 17c1.1-4 4-6 8.3-5.6.2 4.4-2.2 7.2-6.5 7.8"
          fill="url(#fl-mark-leaf)"
        />

        {/* The link: a connecting node on the stem */}
        <circle
          cx="20"
          cy="23.4"
          r="2.5"
          fill="var(--color-brand-400)"
          className={animated ? "animate-pulse-ring" : undefined}
        />
        <circle cx="20" cy="23.4" r="4.6" stroke="var(--color-brand-400)" strokeOpacity="0.35" />
      </svg>
    </span>
  );
}

/** Wordmark + mark, for the landing page and auth screens. */
export function BrandLockup({ size = 36, className = "", tone = "dark" }) {
  const text = tone === "dark" ? "text-ink" : "text-white";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <span className={`text-[17px] font-bold tracking-tight ${text}`}>
        FarmLink <span className="text-brand-500">AI</span>
      </span>
    </span>
  );
}
