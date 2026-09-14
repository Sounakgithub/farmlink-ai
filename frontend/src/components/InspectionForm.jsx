import { useState } from "react";
import { Button, Modal, inputClass } from "./ui";
import { INSPECTION_CHECKS, INSPECTION_GRADES } from "../lib/constants";

/**
 * The farm-gate quality check a driver records before collecting an order.
 *
 * Mirrors the server's rules so the driver sees the consequence before
 * submitting: a failed freshness or pest check, a REJECT grade or a short
 * weight stops the shipment and refunds the buyer, and has to be explained.
 */

const splitPhotos = (text) =>
  text
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => /^https?:\/\//i.test(p))
    .slice(0, 8);

export default function InspectionForm({
  open,
  order,
  weightTolerancePct = 5,
  busy = false,
  onSubmit,
  onClose,
}) {
  const orderedKg = (order?.products || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  const [grade, setGrade] = useState("A");
  const [checks, setChecks] = useState({ freshness: true, pestFree: true, packaging: true, moistureOk: true });
  const [measuredKg, setMeasuredKg] = useState(orderedKg ? String(orderedKg) : "");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState("");

  // Reset when a different order is opened. Adjusting state during render
  // avoids an effect-driven second pass.
  const [forOrder, setForOrder] = useState(order?._id);
  if (order?._id !== forOrder) {
    setForOrder(order?._id);
    setGrade("A");
    setChecks({ freshness: true, pestFree: true, packaging: true, moistureOk: true });
    setMeasuredKg(orderedKg ? String(orderedKg) : "");
    setNotes("");
    setPhotos("");
  }

  const weight = measuredKg === "" ? null : Number(measuredKg);
  const shortWeight =
    weight !== null && orderedKg > 0 && weight < orderedKg * (1 - weightTolerancePct / 100);
  const failing =
    grade === "REJECT" || checks.freshness === false || checks.pestFree === false || shortWeight;
  const photoList = splitPhotos(photos);

  const problems = [];
  if (failing && notes.trim().length < 5) problems.push("Explain what is wrong — the farmer will see it.");
  if (grade === "REJECT" && photoList.length === 0) problems.push("A reject needs at least one photo link.");
  if (weight !== null && (!Number.isFinite(weight) || weight < 0)) problems.push("Weight must be a number of kg.");

  const submit = (e) => {
    e.preventDefault();
    if (problems.length) return;
    onSubmit?.({
      grade,
      checks,
      measuredKg: weight,
      notes: notes.trim(),
      photos: photoList,
    });
  };

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title="Pickup quality check"
      description={
        order
          ? `${order.products.map((l) => `${l.quantity} kg ${l.cropName}`).join(", ")} · ${order.products[0]?.location || "farm"}`
          : ""
      }
      maxWidth="max-w-xl"
    >
      <form onSubmit={submit} className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-ink">Grade</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {INSPECTION_GRADES.map((g) => {
              const active = grade === g.value;
              const reject = g.value === "REJECT";
              return (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGrade(g.value)}
                  aria-pressed={active}
                  title={g.hint}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                    active
                      ? reject
                        ? "border-rose-400 bg-rose-50 text-rose-700"
                        : "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-line text-ink-soft hover:border-line-strong"
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            {INSPECTION_GRADES.find((g) => g.value === grade)?.hint}
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-ink">Checks</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {INSPECTION_CHECKS.map((c) => {
              const ok = checks[c.key] !== false;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setChecks({ ...checks, [c.key]: !ok })}
                  aria-pressed={ok}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    ok
                      ? "border-line bg-surface text-ink"
                      : c.fails
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-harvest-300 bg-harvest-50 text-harvest-700"
                  }`}
                >
                  <span className="font-semibold">{c.label}</span>
                  <span className="text-xs font-bold">
                    {ok ? "✓ Pass" : c.fails ? "✕ Fail" : "! Note"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-ink">Weighed at pickup (kg)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={measuredKg}
            onChange={(e) => setMeasuredKg(e.target.value)}
            className={inputClass}
          />
          <span className={`mt-1.5 block text-xs ${shortWeight ? "font-semibold text-rose-600" : "text-ink-faint"}`}>
            {shortWeight
              ? `More than ${weightTolerancePct}% short of the ${orderedKg} kg ordered.`
              : `${orderedKg} kg ordered · ${weightTolerancePct}% tolerance`}
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-ink">
            Notes {!failing && <span className="font-normal text-ink-faint">(optional)</span>}
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What you saw at the farm gate"
            className={`${inputClass} resize-none`}
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-ink">
            Photo links {grade !== "REJECT" && <span className="font-normal text-ink-faint">(optional)</span>}
          </span>
          <input
            type="text"
            value={photos}
            onChange={(e) => setPhotos(e.target.value)}
            placeholder="https://… (separate several with spaces)"
            className={inputClass}
          />
        </label>

        {failing ? (
          <p className="rounded-xl bg-rose-50 p-3 text-xs leading-5 text-rose-700 ring-1 ring-rose-100">
            This load will <strong>fail inspection</strong>. The order is rejected, the buyer is
            refunded and nothing leaves the farm.
          </p>
        ) : (
          <p className="rounded-xl bg-brand-50 p-3 text-xs leading-5 text-brand-800 ring-1 ring-brand-100">
            Passing loads are collected straight away and the buyer is notified.
          </p>
        )}

        {problems.length > 0 && (
          <ul className="space-y-1 text-xs font-medium text-rose-600">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            className={`flex-1 ${failing ? "bg-rose-600 shadow-none hover:bg-rose-700" : ""}`}
            loading={busy}
            disabled={problems.length > 0}
          >
            {failing ? "Record failure" : "Pass & collect"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
