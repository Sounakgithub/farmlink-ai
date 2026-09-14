import { useState } from "react";
import AppShell from "../../components/AppShell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  SectionHeader,
  Segmented,
  SkeletonCards,
  SkeletonRows,
  StatCard,
  inputClass,
} from "../../components/ui";
import { admin } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useToast } from "../../context/ToastContext";
import { currency, formatDate, shortId } from "../../lib/format";

/**
 * Platform operations: money and queues at a glance, dispute decisions,
 * wholesale and carrier verification, fee settings and the audit trail.
 */

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "disputes", label: "Disputes" },
  { value: "businesses", label: "Businesses" },
  { value: "carriers", label: "Carriers" },
  { value: "settings", label: "Settings" },
  { value: "audit", label: "Audit" },
];

// ---------------------------------------------------------------------------
function Overview() {
  const toast = useToast();
  const { data, loading, error, reload } = useAsyncData(async () => {
    const [overview, pairs] = await Promise.all([admin.overview(), admin.pairs()]);
    return { overview, pairs: pairs.pairs };
  });
  const [sweeping, setSweeping] = useState(false);

  const sweep = async () => {
    setSweeping(true);
    try {
      const r = await admin.runSweeps();
      toast.success(`Released ${r.released} escrow(s), moved ${r.offersMoved} expired offer(s).`);
      reload({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSweeping(false);
    }
  };

  if (loading) return <SkeletonCards count={8} />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const { overview: o, pairs } = data;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon="₹" tone="emerald" label="Captured from buyers" value={currency(o.money.captured)} />
        <StatCard icon="⏸" tone="blue" label="Held in escrow" value={currency(o.money.inEscrow)} />
        <StatCard icon="◈" tone="purple" label="Platform revenue" value={currency(o.money.platformRevenue)} hint={`Advances fronted: ${currency(o.money.platformAdvances)}`} />
        <StatCard
          icon="🧾"
          tone="amber"
          label="Open invoices"
          value={currency(o.money.outstandingInvoices)}
          hint={o.money.overdueInvoices ? `${o.money.overdueInvoices} overdue` : "None overdue"}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon="⚖" tone="amber" label="Open disputes" value={o.attention.disputes} />
        <StatCard icon="🏢" tone="blue" label="Business requests" value={o.attention.businessRequests} />
        <StatCard icon="🚚" tone="purple" label="Unverified carriers" value={o.attention.unverifiedProviders} />
        <StatCard
          icon="🔍"
          tone="emerald"
          label="Pickup pass rate"
          value={o.quality.pickupPassRatePct == null ? "—" : `${o.quality.pickupPassRatePct}%`}
          hint={`${o.quality.pickupInspections} inspections`}
        />
      </section>

      <Card className="p-5 sm:p-6">
        <SectionHeader
          title="Timed jobs"
          description="Escrow auto-release and carrier offer expiry run every minute on the server. Run them now to catch up."
          action={
            <Button variant="outline" loading={sweeping} onClick={sweep}>
              Run now
            </Button>
          }
        />
        <p className="mt-3 text-xs text-ink-soft">
          Orders by status:{" "}
          {Object.entries(o.orders)
            .map(([status, n]) => `${status} ${n}`)
            .join(" · ") || "none"}
          {` · open carrier offers ${o.attention.openOffers}`}
        </p>
      </Card>

      <section>
        <SectionHeader
          title="Working relationships"
          description="Farmer–buyer pairs with the most completed orders, and how their produce fared at inspection."
        />
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-3">Farmer</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Orders</th>
                <th className="px-4 py-3">Traded</th>
                <th className="px-4 py-3">Pickup pass</th>
                <th className="px-4 py-3">Disputes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pairs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-soft">
                    No completed orders yet.
                  </td>
                </tr>
              ) : (
                pairs.map((p) => (
                  <tr key={`${p.farmer.id}-${p.buyer.id}`}>
                    <td className="px-4 py-3 font-semibold text-ink">{p.farmer.name}</td>
                    <td className="px-4 py-3 text-ink">{p.buyer.name}</td>
                    <td className="fl-numeric px-4 py-3">{p.completedOrders}</td>
                    <td className="fl-numeric px-4 py-3">
                      {currency(p.valueTraded)} · {p.kgTraded} kg
                    </td>
                    <td className="fl-numeric px-4 py-3">
                      {p.quality.passRatePct == null ? "—" : `${p.quality.passRatePct}%`}
                    </td>
                    <td className="fl-numeric px-4 py-3">{p.quality.deliveryDisputes}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DisputeCard({ dispute, onResolved }) {
  const toast = useToast();
  const suggested = ["farmer", "logistics", "shared", "none"].includes(dispute.suggestedLiability)
    ? dispute.suggestedLiability
    : "shared";
  const [liability, setLiability] = useState(suggested);
  const [refundPct, setRefundPct] = useState("100");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    setBusy(true);
    try {
      const r = await admin.resolveDispute(dispute.orderId, {
        liability,
        refundPct: Number(refundPct),
        notes,
      });
      toast.success(
        `Resolved: refund ${currency(r.resolution.refundAmount)}${
          r.claimAgainstCarrier ? `, claim ${currency(r.claimAgainstCarrier)} from carrier` : ""
        }.`
      );
      onResolved?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="fl-eyebrow text-ink-faint">Order {shortId(dispute.orderId)}</p>
          <h3 className="mt-1 font-bold text-ink">{dispute.crops.join(", ")}</h3>
          <p className="mt-1 text-xs text-ink-soft">
            {dispute.farmers.join(", ")} → {dispute.buyerName} · carrier {dispute.carrier} · disputed{" "}
            {formatDate(dispute.disputedAt)}
          </p>
        </div>
        <div className="text-right">
          <p className="fl-numeric text-xl font-bold text-ink">{currency(dispute.grandTotal)}</p>
          <p className="text-xs text-ink-soft">buyer paid</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {dispute.inspections.map((i) => (
          <div key={i.stage} className="rounded-xl border border-line bg-canvas p-3 text-xs text-ink-soft">
            <p className="text-sm font-bold text-ink">
              {i.stage === "pickup" ? "Farm gate" : "Delivery"} ·{" "}
              {i.stage === "pickup" ? `grade ${i.grade}` : i.condition} · {i.result}
            </p>
            <p className="mt-1">
              {i.inspectorName}
              {i.measuredKg != null ? ` · ${i.measuredKg} of ${i.expectedKg} kg` : ""}
            </p>
            {i.notes && <p className="mt-1 italic">“{i.notes}”</p>}
            {i.photos?.map((url, n) => (
              <a key={url} href={url} target="_blank" rel="noreferrer noopener" className="mr-2 font-semibold text-brand-700">
                Photo {n + 1} ↗
              </a>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-3 rounded-xl bg-sky-50 p-3 text-xs text-sky-700 ring-1 ring-sky-100">
        Suggested from the chain of custody: <strong>{dispute.suggestedLiability}</strong> —{" "}
        {dispute.suggestionReason}
        {dispute.carrierLiability?.coveragePct
          ? ` · carrier cover ${dispute.carrierLiability.coveragePct}% up to ${currency(dispute.carrierLiability.maxPerOrder)}`
          : ""}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px]">
        <Field label="Who carries the loss">
          <select value={liability} onChange={(e) => setLiability(e.target.value)} className={inputClass}>
            <option value="farmer">Farmer</option>
            <option value="logistics">Carrier</option>
            <option value="shared">Shared</option>
            <option value="none">Nobody (goodwill refund)</option>
          </select>
        </Field>
        <Field label="Refund %">
          <input
            type="number"
            min="0"
            max="100"
            value={refundPct}
            onChange={(e) => setRefundPct(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Decision notes" hint="Recorded in the audit trail and shown to the parties.">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} resize-none`} />
      </Field>

      <Button className="mt-4" loading={busy} onClick={resolve}>
        Resolve dispute
      </Button>
    </Card>
  );
}

function Disputes() {
  const { data, loading, error, reload } = useAsyncData(() => admin.disputes(), {
    initialData: { disputes: [] },
  });
  if (loading) return <SkeletonRows count={3} />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (data.disputes.length === 0) {
    return <EmptyState icon="⚖" title="No open disputes" description="Delivery reports that need a decision will appear here." />;
  }
  return (
    <div className="space-y-5">
      {data.disputes.map((d) => (
        <DisputeCard key={d.orderId} dispute={d} onResolved={reload} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function BusinessRow({ account, onDone }) {
  const toast = useToast();
  const [terms, setTerms] = useState("net30");
  const [limit, setLimit] = useState("100000");
  const [busy, setBusy] = useState("");

  const decide = async (decision) => {
    setBusy(decision);
    try {
      const r = await admin.decideBusiness(account.id, {
        decision,
        paymentTerms: terms,
        creditLimit: terms === "prepaid" ? 0 : Number(limit),
      });
      toast.success(r.message);
      onDone?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-ink">{account.business?.companyName}</h3>
          <p className="mt-1 font-mono text-xs text-ink-soft">GSTIN {account.business?.gstin}</p>
          <p className="mt-1 text-xs text-ink-soft">
            {account.name} · {account.email} · {account.location || "no city"} · member since{" "}
            {formatDate(account.memberSince)}
          </p>
        </div>
        <Badge tone="amber">Requested</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_auto_auto] sm:items-end">
        <Field label="Terms">
          <select value={terms} onChange={(e) => setTerms(e.target.value)} className={inputClass}>
            <option value="prepaid">Prepaid only</option>
            <option value="net15">Net 15</option>
            <option value="net30">Net 30</option>
          </select>
        </Field>
        <Field label="Credit limit (₹)">
          <input
            type="number"
            min="0"
            value={terms === "prepaid" ? "0" : limit}
            disabled={terms === "prepaid"}
            onChange={(e) => setLimit(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Button variant="secondary" loading={busy === "decline"} disabled={!!busy} onClick={() => decide("decline")}>
          Decline
        </Button>
        <Button loading={busy === "approve"} disabled={!!busy} onClick={() => decide("approve")}>
          Verify
        </Button>
      </div>
    </Card>
  );
}

function Businesses() {
  const { data, loading, error, reload } = useAsyncData(() => admin.businessAccounts("requested"), {
    initialData: { accounts: [] },
  });
  if (loading) return <SkeletonRows count={3} />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (data.accounts.length === 0) {
    return <EmptyState icon="🏢" title="No pending requests" description="Buyers asking for wholesale accounts will appear here for GSTIN verification." />;
  }
  return (
    <div className="space-y-4">
      {data.accounts.map((a) => (
        <BusinessRow key={a.id} account={a} onDone={reload} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Carriers() {
  const toast = useToast();
  const { data, setData, loading, error, reload } = useAsyncData(() => admin.providers(), {
    initialData: { providers: [] },
  });

  const moderate = async (provider, patch) => {
    try {
      const r = await admin.moderateProvider(provider.id, patch);
      setData({
        providers: data.providers.map((p) => (p.id === provider.id ? { ...p, ...r.provider } : p)),
      });
      toast.success(r.message);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <SkeletonRows count={3} />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (data.providers.length === 0) {
    return <EmptyState icon="🚚" title="No logistics companies yet" description="Carriers that sign up appear here for verification." />;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-faint">
          <tr>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Coverage</th>
            <th className="px-4 py-3">Rates</th>
            <th className="px-4 py-3">Record</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.providers.map((p) => (
            <tr key={p.id} className="align-top">
              <td className="px-4 py-3">
                <p className="font-semibold text-ink">{p.name}</p>
                <p className="text-xs text-ink-soft">
                  {p.owner?.email} · {p.drivers} driver{p.drivers === 1 ? "" : "s"}
                </p>
                <div className="mt-1 flex gap-1">
                  <Badge tone={p.verified ? "brand" : "amber"}>{p.verified ? "Verified" : "Unverified"}</Badge>
                  {!p.active && <Badge tone="rose">Suspended</Badge>}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-ink-soft">{p.coverageCities?.join(", ") || "—"}</td>
              <td className="fl-numeric px-4 py-3 text-xs text-ink-soft">
                {currency(p.rateCard?.baseFee)} + {currency(p.rateCard?.perKm)}/km + {currency(p.rateCard?.perKg)}/kg
                <br />
                cover {p.liability?.coveragePct}% ≤ {currency(p.liability?.maxPerOrder)}
              </td>
              <td className="fl-numeric px-4 py-3 text-xs text-ink-soft">
                {p.stats?.accepted || 0}/{p.stats?.offered || 0} accepted · {p.stats?.delivered || 0} delivered ·{" "}
                {p.stats?.damageClaims || 0} claims
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant={p.verified ? "secondary" : "primary"} onClick={() => moderate(p, { verified: !p.verified })}>
                    {p.verified ? "Unverify" : "Verify"}
                  </Button>
                  <Button size="sm" variant={p.active ? "danger" : "outline"} onClick={() => moderate(p, { active: !p.active })}>
                    {p.active ? "Suspend" : "Reinstate"}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
const SETTING_FIELDS = [
  { group: "Consumer fees", fields: [["fees.consumer.commissionPct", "Commission on produce (%)"], ["fees.consumer.logisticsMarkupPct", "Markup on delivery (%)"]] },
  { group: "Business fees", fields: [["fees.business.commissionPct", "Commission on produce (%)"], ["fees.business.logisticsMarkupPct", "Markup on delivery (%)"]] },
  {
    group: "Independent driver rates (₹)",
    fields: [
      ["independentRateCard.baseFee", "Base fee"],
      ["independentRateCard.perKm", "Per km"],
      ["independentRateCard.perKg", "Per kg"],
      ["independentRateCard.minFee", "Minimum"],
    ],
  },
  {
    group: "Operations",
    fields: [
      ["inspection.weightTolerancePct", "Weight tolerance (%)"],
      ["escrow.autoReleaseHours", "Auto-release after (hours)"],
      ["logistics.offerTtlMinutes", "Carrier offer expires after (min)"],
      ["b2b.minLineQuantityKg", "Wholesale minimum per line (kg)"],
    ],
  },
];

const readPath = (obj, path) => path.split(".").reduce((n, k) => (n == null ? undefined : n[k]), obj);
const writePath = (obj, path, value) => {
  const keys = path.split(".");
  const out = { ...obj };
  let node = out;
  keys.slice(0, -1).forEach((k) => {
    node[k] = { ...(node[k] || {}) };
    node = node[k];
  });
  node[keys.at(-1)] = value;
  return out;
};

function Settings() {
  const toast = useToast();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const { data, loading, error, reload } = useAsyncData(async () => {
    const { settings } = await admin.settings();
    return settings;
  });

  const current = draft || data;

  const save = async () => {
    setSaving(true);
    try {
      const patch = {};
      let body = patch;
      for (const { fields } of SETTING_FIELDS) {
        for (const [path] of fields) {
          body = writePath(body, path, Number(readPath(current, path)));
        }
      }
      body = writePath(body, "inspection.requirePickupInspection", !!current.inspection?.requirePickupInspection);
      const r = await admin.saveSettings(body);
      toast.success(r.message);
      setDraft(null);
      reload({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonCards count={4} />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {SETTING_FIELDS.map(({ group, fields }) => (
          <Card key={group} className="p-5">
            <p className="font-bold text-ink">{group}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {fields.map(([path, label]) => (
                <Field key={path} label={label}>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    value={readPath(current, path) ?? ""}
                    onChange={(e) => setDraft(writePath(current, path, e.target.value))}
                    className={inputClass}
                  />
                </Field>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={!!current.inspection?.requirePickupInspection}
          onChange={(e) => setDraft(writePath(current, "inspection.requirePickupInspection", e.target.checked))}
          className="h-4 w-4 accent-brand-600"
        />
        Require a passed pickup inspection before goods leave the farm
      </label>

      <div className="flex gap-2">
        <Button loading={saving} disabled={!draft} onClick={save}>
          Save settings
        </Button>
        {draft && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Discard changes
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-faint">
        Changes apply to new quotes and orders immediately. Every change is recorded in the audit trail.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AuditResults({ query, onPage }) {
  // Keyed on the query by the parent, so each filter or page is a fresh load.
  const { data, loading, error, reload } = useAsyncData(() => admin.audit(query), {
    initialData: { entries: [], total: 0, page: 1, limit: 50 },
  });

  return (
    <>
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading ? (
        <SkeletonRows count={6} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-soft">
                    No matching entries.
                  </td>
                </tr>
              ) : (
                data.entries.map((e) => (
                  <tr key={e._id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-soft">{formatDate(e.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className="font-semibold text-ink">{e.actorName || e.channel}</span>
                      <span className="block text-ink-faint">{e.actorRole || e.channel}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink">{e.action}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">
                      {e.entityType} {e.entityId ? shortId(e.entityId) : ""}
                    </td>
                    <td className="max-w-md px-4 py-2.5">
                      <code className="block truncate text-[11px] text-ink-soft" title={JSON.stringify(e.details)}>
                        {JSON.stringify(e.details)}
                      </code>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-ink-soft">
        <span>
          {data.total} entries · page {query.page}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={query.page <= 1} onClick={() => onPage(query.page - 1)}>
            ← Newer
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={loading || query.page * data.limit >= data.total}
            onClick={() => onPage(query.page + 1)}
          >
            Older →
          </Button>
        </div>
      </div>
    </>
  );
}

function Audit() {
  const [filters, setFilters] = useState({ action: "", entityId: "" });
  const [query, setQuery] = useState({ action: "", entityId: "", page: 1 });

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ ...filters, page: 1 });
        }}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <Field label="Action starts with">
          <input
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            placeholder="settlement."
            className={inputClass}
          />
        </Field>
        <Field label="Entity id">
          <input
            value={filters.entityId}
            onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
            placeholder="order / user / provider id"
            className={inputClass}
          />
        </Field>
        <Button type="submit">Filter</Button>
      </form>

      <AuditResults
        key={JSON.stringify(query)}
        query={query}
        onPage={(page) => setQuery({ ...query, page })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function AdminConsole() {
  const [tab, setTab] = useState("overview");

  return (
    <AppShell title="Platform console" subtitle="Money, quality, partners and settings">
      <div className="mb-6 overflow-x-auto">
        <Segmented options={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === "overview" && <Overview />}
      {tab === "disputes" && <Disputes />}
      {tab === "businesses" && <Businesses />}
      {tab === "carriers" && <Carriers />}
      {tab === "settings" && <Settings />}
      {tab === "audit" && <Audit />}
    </AppShell>
  );
}
