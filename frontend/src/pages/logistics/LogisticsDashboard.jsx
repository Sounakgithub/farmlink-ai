import { useState } from "react";
import AppShell from "../../components/AppShell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Modal,
  SectionHeader,
  Segmented,
  SkeletonCards,
  StatCard,
  inputClass,
} from "../../components/ui";
import { logistics } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useToast } from "../../context/ToastContext";
import { currency, formatDate, formatDuration, shortId } from "../../lib/format";

/**
 * A logistics company's workspace: the jobs FarmLink offers it (priced at the
 * rate card it publishes), the drivers in its fleet, and the profile that
 * decides which jobs it is eligible for.
 */

const BLANK = {
  name: "",
  contactEmail: "",
  contactPhone: "",
  coverageCities: "",
  vehicleTypes: "",
  refrigerated: false,
  maxLoadKg: "2000",
  rateCard: { baseFee: "40", perKm: "7", perKg: "0.25", minFee: "60" },
  liability: { coveragePct: "80", maxPerOrder: "25000" },
};

const toForm = (p) =>
  p
    ? {
        name: p.name || "",
        contactEmail: p.contactEmail || "",
        contactPhone: p.contactPhone || "",
        coverageCities: (p.coverageCities || []).join(", "),
        vehicleTypes: (p.vehicleTypes || []).join(", "),
        refrigerated: !!p.refrigerated,
        maxLoadKg: String(p.maxLoadKg ?? ""),
        rateCard: Object.fromEntries(
          Object.entries(p.rateCard || {}).map(([k, v]) => [k, String(v)])
        ),
        liability: {
          coveragePct: String(p.liability?.coveragePct ?? ""),
          maxPerOrder: String(p.liability?.maxPerOrder ?? ""),
        },
      }
    : BLANK;

const list = (text) =>
  String(text)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function CompanyForm({ initial, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(toForm(initial));
  const [saving, setSaving] = useState(false);

  const set = (key, value) => setForm({ ...form, [key]: value });
  const setNested = (group, key, value) =>
    setForm({ ...form, [group]: { ...form[group], [key]: value } });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await logistics.saveCompany({
        name: form.name,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        coverageCities: list(form.coverageCities),
        vehicleTypes: list(form.vehicleTypes),
        refrigerated: form.refrigerated,
        maxLoadKg: Number(form.maxLoadKg),
        rateCard: Object.fromEntries(
          Object.entries(form.rateCard).map(([k, v]) => [k, Number(v)])
        ),
        liability: {
          coveragePct: Number(form.liability.coveragePct),
          maxPerOrder: Number(form.liability.maxPerOrder),
        },
      });
      toast.success(result.message);
      onSaved?.(result.provider);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const example =
    Math.max(
      Number(form.rateCard.minFee) || 0,
      (Number(form.rateCard.baseFee) || 0) +
        (Number(form.rateCard.perKm) || 0) * 50 +
        (Number(form.rateCard.perKg) || 0) * 200
    ) || 0;

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name">
          <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Cities you cover" hint="Comma separated. Jobs are offered only where you cover both ends.">
          <input
            className={inputClass}
            value={form.coverageCities}
            onChange={(e) => set("coverageCities", e.target.value)}
            placeholder="Delhi, Gurgaon, Noida"
          />
        </Field>
        <Field label="Contact email">
          <input className={inputClass} type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
        </Field>
        <Field label="Contact phone">
          <input className={inputClass} value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
        </Field>
        <Field label="Vehicles" hint="Comma separated">
          <input className={inputClass} value={form.vehicleTypes} onChange={(e) => set("vehicleTypes", e.target.value)} placeholder="Tata Ace, Eicher 14ft" />
        </Field>
        <Field label="Largest load (kg)">
          <input className={inputClass} type="number" min="1" value={form.maxLoadKg} onChange={(e) => set("maxLoadKg", e.target.value)} />
        </Field>
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">Rate card (₹)</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["baseFee", "Base fee"],
            ["perKm", "Per km"],
            ["perKg", "Per kg"],
            ["minFee", "Minimum"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                className={inputClass}
                type="number"
                min="0"
                step="0.05"
                value={form.rateCard[key] ?? ""}
                onChange={(e) => setNested("rateCard", key, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          A 50 km run carrying 200 kg would pay you {currency(Math.round(example))}.
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold text-ink">Damage liability</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Share of goods value you cover (%)">
            <input
              className={inputClass}
              type="number"
              min="0"
              max="100"
              value={form.liability.coveragePct}
              onChange={(e) => setNested("liability", "coveragePct", e.target.value)}
            />
          </Field>
          <Field label="Cap per order (₹)">
            <input
              className={inputClass}
              type="number"
              min="0"
              value={form.liability.maxPerOrder}
              onChange={(e) => setNested("liability", "maxPerOrder", e.target.value)}
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Shown to buyers. When produce passes inspection at the farm and arrives damaged, claims
          against you are limited to this cover.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={form.refrigerated}
          onChange={(e) => set("refrigerated", e.target.checked)}
          className="h-4 w-4 accent-brand-600"
        />
        We run refrigerated vehicles
      </label>

      <Button type="submit" loading={saving}>
        {initial ? "Save company profile" : "Create company"}
      </Button>
    </form>
  );
}

function OfferCard({ offer, drivers, onDone }) {
  const toast = useToast();
  const [driverId, setDriverId] = useState(drivers[0]?.id || "");
  const [busy, setBusy] = useState("");
  const open = offer.status === "offered";
  const expiresAt = open
    ? new Date(offer.expiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  const act = async (kind) => {
    setBusy(kind);
    try {
      const result =
        kind === "accept"
          ? await logistics.accept(offer.id, driverId)
          : await logistics.reject(offer.id, "Declined from dashboard");
      toast.success(result.message);
      onDone?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="fl-eyebrow text-ink-faint">Order {shortId(offer.order?.id)}</p>
          <h3 className="mt-1 font-bold text-ink">{offer.order?.crops?.join(", ")}</h3>
          <p className="mt-1 text-xs text-ink-soft">
            🌾 {offer.order?.pickup?.join(" → ")} → 🏠 {offer.order?.drop}
            {offer.order?.buyerName ? ` · ${offer.order.buyerName}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="fl-numeric text-2xl font-bold text-ink">{currency(offer.quote?.providerFee)}</p>
          <p className="fl-numeric text-xs text-ink-soft">
            {offer.quote?.distanceKm} km · {formatDuration(offer.quote?.durationMin)} · {offer.quote?.weightKg} kg
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone={open ? "amber" : offer.status === "accepted" ? "brand" : "neutral"}>
          {open ? `Offer · answer by ${expiresAt}` : offer.status}
        </Badge>
        {offer.order?.pickupInspection && (
          <Badge tone={offer.order.pickupInspection === "passed" ? "brand" : "rose"}>
            Pickup inspection {offer.order.pickupInspection}
          </Badge>
        )}
        {offer.order?.status && <Badge tone="neutral">{offer.order.status}</Badge>}
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
          {drivers.length === 0 ? (
            <p className="flex-1 text-xs text-harvest-700">
              Add a driver with your join code before you can accept jobs.
            </p>
          ) : (
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="flex-1 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-sm"
              aria-label="Driver for this job"
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.location ? ` · ${d.location}` : ""}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" loading={busy === "reject"} disabled={!!busy} onClick={() => act("reject")}>
            Decline
          </Button>
          <Button loading={busy === "accept"} disabled={!!busy || !driverId} onClick={() => act("accept")}>
            Accept job
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function LogisticsDashboard() {
  const toast = useToast();
  const [tab, setTab] = useState("offered");
  const [editing, setEditing] = useState(false);

  const { data, setData, loading, error, reload } = useAsyncData(
    async () => {
      const { provider } = await logistics.myCompany();
      if (!provider) return { provider: null, offers: [], drivers: [] };
      const [assignments, fleet] = await Promise.all([logistics.assignments(), logistics.drivers()]);
      return { provider, offers: assignments.assignments, drivers: fleet.drivers };
    },
    { initialData: { provider: null, offers: [], drivers: [] } }
  );

  const { provider, offers, drivers } = data;
  const shown = offers.filter((o) => (tab === "all" ? true : o.status === tab));

  const removeDriver = async (driver) => {
    try {
      await logistics.removeDriver(driver.id);
      setData({ ...data, drivers: drivers.filter((d) => d.id !== driver.id) });
      toast.success(`${driver.name} removed from your fleet.`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <AppShell
      title={provider?.name || "Your logistics company"}
      subtitle="Delivery jobs, your fleet and your rates"
      actions={
        provider && (
          <Button variant="secondary" onClick={reload}>
            ↻ Refresh
          </Button>
        )
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} className="mb-6" />}

      {loading ? (
        <SkeletonCards count={4} />
      ) : !provider ? (
        <Card className="mx-auto max-w-3xl p-6 sm:p-8">
          <SectionHeader
            eyebrow="Get started"
            title="Set up your company"
            description="Publish where you operate and what you charge. Once FarmLink verifies you, farm deliveries in your area are offered to you at your own rates."
          />
          <div className="mt-6">
            <CompanyForm initial={null} onSaved={() => reload()} />
          </div>
        </Card>
      ) : (
        <div className="space-y-10">
          {!provider.verified && (
            <p className="rounded-2xl bg-harvest-50 p-4 text-sm text-harvest-700 ring-1 ring-harvest-100">
              ⏳ Awaiting verification. FarmLink checks new carriers before offering them deliveries —
              meanwhile, add your drivers with the join code below.
            </p>
          )}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon="✉" tone="amber" label="Offers received" value={provider.stats?.offered || 0} />
            <StatCard icon="✓" tone="emerald" label="Accepted" value={provider.stats?.accepted || 0} />
            <StatCard icon="🚚" tone="blue" label="Delivered" value={provider.stats?.delivered || 0} />
            <StatCard
              icon="⚖"
              tone="purple"
              label="Damage claims"
              value={provider.stats?.damageClaims || 0}
              hint={`Cover ${provider.liability?.coveragePct}% up to ${currency(provider.liability?.maxPerOrder)}`}
            />
          </section>

          <section>
            <SectionHeader
              title="Delivery jobs"
              description="Each job pays the rate FarmLink locked in at checkout. Offers expire if not answered, and pass to the next carrier."
              action={
                <Segmented
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "offered", label: "Open offers" },
                    { value: "accepted", label: "Accepted" },
                    { value: "all", label: "History" },
                  ]}
                />
              }
            />
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {shown.length === 0 ? (
                <EmptyState
                  className="lg:col-span-2"
                  icon="🚚"
                  title={tab === "offered" ? "No open offers" : "Nothing here yet"}
                  description={
                    provider.verified
                      ? "Jobs appear when a farmer in your coverage accepts an order you can carry."
                      : "Offers start once your company is verified."
                  }
                />
              ) : (
                shown.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} drivers={drivers} onDone={reload} />
                ))
              )}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5 sm:p-6">
              <SectionHeader
                title="Your fleet"
                description="Drivers join from their FarmLink profile with this code."
              />
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-soil-900 px-5 py-4 text-white">
                <span className="font-mono text-2xl font-bold tracking-[0.3em]">{provider.joinCode}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white ring-1 ring-white/20 hover:bg-white/10 hover:text-white"
                  onClick={() => {
                    navigator.clipboard?.writeText(provider.joinCode);
                    toast.success("Join code copied.");
                  }}
                >
                  Copy
                </Button>
              </div>
              <ul className="mt-4 divide-y divide-line">
                {drivers.length === 0 ? (
                  <li className="py-3 text-sm text-ink-soft">No drivers yet.</li>
                ) : (
                  drivers.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{d.name}</p>
                        <p className="truncate text-xs text-ink-soft">
                          {[d.phone, d.location].filter(Boolean).join(" · ") || "No contact details"}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removeDriver(d)}>
                        Remove
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </Card>

            <Card className="p-5 sm:p-6">
              <SectionHeader
                title="Company profile"
                action={
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                }
              />
              <dl className="mt-4 space-y-2 text-sm">
                {[
                  ["Status", provider.verified ? "Verified" : "Awaiting verification"],
                  ["Coverage", provider.coverageCities?.join(", ") || "—"],
                  [
                    "Rates",
                    `${currency(provider.rateCard?.baseFee)} + ${currency(provider.rateCard?.perKm)}/km + ${currency(provider.rateCard?.perKg)}/kg (min ${currency(provider.rateCard?.minFee)})`,
                  ],
                  ["Largest load", `${provider.maxLoadKg} kg`],
                  ["Refrigerated", provider.refrigerated ? "Yes" : "No"],
                  ["Since", formatDate(provider.createdAt)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-ink-soft">{k}</dt>
                    <dd className="text-right font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </section>
        </div>
      )}

      <Modal open={editing} onClose={() => setEditing(false)} title="Company profile">
        {editing && (
          <CompanyForm
            initial={provider}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
          />
        )}
      </Modal>
    </AppShell>
  );
}
