// Small shared building blocks used across every page.

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function StatCard({ icon, label, value, hint, tone = "emerald" }) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    purple: "border-purple-100 bg-purple-50 text-purple-700",
  };

  return (
    <div className={`rounded-2xl border p-5 sm:p-6 ${tones[tone] || tones.emerald}`}>
      <div className="text-2xl">{icon}</div>
      <p className="mt-4 text-sm text-slate-600">{label}</p>
      <h3 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{value}</h3>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon = "🌱", title, description, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center sm:p-12">
      <div className="text-5xl">{icon}</div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">{title}</h3>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
      <span>⚠️ {message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="w-fit rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-amber-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function Badge({ children, className = "" }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

export function Button({
  as: Tag = "button",
  variant = "primary",
  className = "",
  children,
  ...props
}) {
  const variants = {
    primary:
      "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:bg-emerald-300",
    secondary:
      "bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:text-slate-400",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 disabled:text-red-300",
    outline:
      "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  };

  return (
    <Tag
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${
        variants[variant] || variants.primary
      } ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function Modal({ open, onClose, title, description, children, maxWidth = "max-w-2xl" }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[900] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl ${maxWidth}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h2>
            {description && (
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            )}
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-sm hover:bg-slate-200"
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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[950] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>

          <Button
            className={`flex-1 ${
              tone === "danger" ? "bg-red-600 hover:bg-red-700 disabled:bg-red-300" : ""
            }`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
