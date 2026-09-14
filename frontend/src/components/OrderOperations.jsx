import { useState } from "react";
import { Badge, Button, Skeleton, inputClass } from "./ui";
import { operations } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { DELIVERY_CONDITIONS, SETTLEMENT_INFO } from "../lib/constants";
import { currency, formatDate } from "../lib/format";

/**
 * "Payment & quality" for one order: where the money is, what each
 * inspection found, who carried it, and - for the buyer, once it arrives -
 * the delivery confirmation that releases payment or opens a dispute.
 *
 * Collapsed by default and loaded on first open, so a long order list does
 * not fire one request per order.
 */

function Row({ label, value, strong = false, muted = false }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={muted ? "text-ink-faint" : "text-ink-soft"}>{label}</span>
      <span className={`fl-numeric ${strong ? "font-bold text-ink" : "font-medium text-ink"}`}>{value}</span>
    </div>
  );
}

function ChargesBlock({ viewer, charges }) {
  if (!charges) return null;

  if (viewer === "farmer") {
    if (charges.payout == null) return null;
    return (
      <div className="space-y-2">
        <Row label="Your produce" value={currency(charges.goods)} />
        <Row label={`Platform commission (${charges.commissionPct}%)`} value={`− ${currency(charges.commission)}`} muted />
        <Row label="Your payout" value={currency(charges.payout)} strong />
      </div>
    );
  }

  if (viewer === "carrier") {
    if (charges.deliveryPayout == null) return null;
    return (
      <div className="space-y-2">
        <Row label="Delivery payout" value={currency(charges.deliveryPayout)} strong />
        {charges.quote?.distanceKm != null && (
          <Row label="Route" value={`${charges.quote.distanceKm} km`} muted />
        )}
      </div>
    );
  }

  // buyer and admin
  if (!charges.grandTotal) return null;
  return (
    <div className="space-y-2">
      <Row label="Produce" value={currency(charges.goods)} />
      <Row
        label={
          charges.logisticsMarkupPct != null
            ? `Delivery (carrier ${currency(charges.carrierRate ?? charges.logisticsPayout)} + ${charges.logisticsMarkupPct}%)`
            : "Delivery"
        }
        value={currency(charges.deliveryFee)}
      />
      <Row label="Total paid" value={currency(charges.grandTotal)} strong />
      {viewer === "admin" && (
        <>
          <Row label="Farmer payout" value={currency(charges.farmerPayout)} muted />
          <Row label="Platform revenue" value={currency(charges.platformRevenue)} muted />
        </>
      )}
    </div>
  );
}

function InspectionRecord({ record }) {
  const pickup = record.stage === "pickup";
  const good = record.result === "passed";
  return (
    <div className="rounded-xl border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">
          {pickup ? "🌾 At the farm gate" : "🏠 At delivery"}
        </p>
        <Badge tone={good ? "brand" : record.result === "failed" ? "rose" : "amber"}>
          {good ? "Passed" : record.result === "failed" ? "Failed" : "Disputed"}
          {pickup && record.grade ? ` · Grade ${record.grade}` : ""}
          {!pickup && record.condition ? ` · ${record.condition}` : ""}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        {record.inspectorName} · {formatDate(record.at)}
        {record.measuredKg != null ? ` · ${record.measuredKg} of ${record.expectedKg} kg` : ""}
      </p>
      {record.reasons?.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
          {record.reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      )}
      {record.notes && <p className="mt-2 text-xs italic text-ink-soft">“{record.notes}”</p>}
      {record.photos?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {record.photos.map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
            >
              Photo {i + 1} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function DeliveryConfirmation({ orderId, orderedKg, onDone }) {
  const toast = useToast();
  const [condition, setCondition] = useState("good");
  const [receivedKg, setReceivedKg] = useState(String(orderedKg || ""));
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState("");
  const [busy, setBusy] = useState(false);

  const problem = condition !== "good" && notes.trim().length < 5;

  const submit = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const result = await operations.confirmDelivery(orderId, {
        condition,
        receivedKg: receivedKg === "" ? undefined : Number(receivedKg),
        notes: notes.trim(),
        photos: photos.split(/[\s,]+/).filter((p) => /^https?:\/\//i.test(p)),
      });
      toast.success(result.message);
      onDone?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
      <p className="text-sm font-bold text-ink">How did your order arrive?</p>
      <p className="mt-0.5 text-xs text-ink-soft">
        Confirming good condition pays the farmer and carrier now. Reporting a problem
        freezes payment while FarmLink reviews it.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DELIVERY_CONDITIONS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCondition(c.value)}
            aria-pressed={condition === c.value}
            title={c.hint}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
              condition === c.value
                ? c.value === "good"
                  ? "border-brand-500 bg-white text-brand-800"
                  : "border-rose-400 bg-white text-rose-700"
                : "border-line bg-surface text-ink-soft hover:border-line-strong"
            }`}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-ink">Received (kg)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={receivedKg}
            onChange={(e) => setReceivedKg(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-ink">Photo links (optional)</span>
          <input
            type="text"
            value={photos}
            onChange={(e) => setPhotos(e.target.value)}
            placeholder="https://…"
            className={inputClass}
          />
        </label>
      </div>

      {condition !== "good" && (
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-ink">What went wrong?</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inputClass} resize-none`}
          />
        </label>
      )}

      <Button
        className={`mt-4 w-full sm:w-auto ${condition !== "good" ? "bg-rose-600 shadow-none hover:bg-rose-700" : ""}`}
        loading={busy}
        disabled={problem}
        onClick={submit}
      >
        {condition === "good" ? "✓ Confirm & release payment" : "Report problem"}
      </Button>
    </div>
  );
}

export default function OrderOperations({ orderId, orderedKg }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await operations.forOrder(orderId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data && !loading) load();
  };

  const settlement = data ? SETTLEMENT_INFO[data.settlement?.status] : null;

  return (
    <div className="rounded-2xl border border-line">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-bold text-ink">Payment & quality</span>
        <span className="flex items-center gap-2">
          {settlement && <Badge tone={settlement.tone}>{settlement.label}</Badge>}
          <span className={`text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-line px-4 py-4">
          {loading && !data ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : error ? (
            <p className="text-xs text-harvest-700">⚠️ {error}</p>
          ) : data ? (
            <>
              {settlement && (
                <p className="text-xs leading-5 text-ink-soft">
                  {settlement.hint}
                  {data.settlement?.status === "held" && data.settlement.autoReleaseAt
                    ? ` Automatic release ${formatDate(data.settlement.autoReleaseAt)}.`
                    : ""}
                </p>
              )}

              <ChargesBlock viewer={data.viewer} charges={data.charges} />

              {data.invoice?.number && (
                <p className="rounded-xl bg-canvas p-3 text-xs text-ink-soft ring-1 ring-line">
                  Invoice <strong className="text-ink">{data.invoice.number}</strong> ·{" "}
                  {data.invoice.terms} · due {formatDate(data.invoice.dueAt)}
                  {data.invoice.paidAt ? ` · paid ${formatDate(data.invoice.paidAt)}` : ""}
                </p>
              )}

              <div>
                <p className="fl-eyebrow text-ink-faint">Carrier</p>
                <p className="mt-1 text-sm text-ink">
                  {data.logistics.mode === "provider"
                    ? `${data.logistics.providerName}${
                        data.logistics.liability?.coveragePct
                          ? ` · covers ${data.logistics.liability.coveragePct}% of damage up to ${currency(data.logistics.liability.maxPerOrder)}`
                          : ""
                      }`
                    : data.logistics.mode === "offered"
                      ? `Waiting for ${data.logistics.providerName} to accept`
                      : data.logistics.mode === "independent"
                        ? "FarmLink independent delivery partner"
                        : "Assigned once the farmer accepts"}
                </p>
              </div>

              <div className="space-y-2">
                <p className="fl-eyebrow text-ink-faint">Quality inspections</p>
                {data.inspection.records.length === 0 ? (
                  <p className="text-xs text-ink-soft">
                    The driver inspects the produce at the farm before collecting it.
                  </p>
                ) : (
                  data.inspection.records.map((r) => <InspectionRecord key={r.id} record={r} />)
                )}
                {data.inspection.liability && !["none", ""].includes(data.inspection.liability) && (
                  <p className="text-xs text-ink-soft">
                    <strong className="text-ink">Responsibility:</strong> {data.inspection.liability} —{" "}
                    {data.inspection.liabilityReason}
                  </p>
                )}
                {data.settlement?.resolution?.decidedAt && (
                  <p className="text-xs text-ink-soft">
                    <strong className="text-ink">Decision:</strong> refund{" "}
                    {currency(data.settlement.resolution.refundAmount)} ·{" "}
                    {data.settlement.resolution.notes || data.settlement.resolution.liability}
                  </p>
                )}
              </div>

              {data.canConfirmDelivery && (
                <DeliveryConfirmation orderId={orderId} orderedKg={orderedKg} onDone={load} />
              )}

              {data.ledger.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-soft hover:text-ink">
                    Money movements ({data.ledger.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {data.ledger.map((row, i) => (
                      <li key={i} className="flex justify-between gap-3 text-xs text-ink-soft">
                        <span className="truncate">{row.memo}</span>
                        <span className="fl-numeric shrink-0 font-semibold text-ink">
                          {currency(row.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <Button variant="ghost" size="sm" onClick={load} loading={loading}>
                ↻ Refresh
              </Button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
