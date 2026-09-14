import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  StatCard,
  inputClass,
} from "../../components/ui";
import { API_BASE, api, b2b } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { API_SCOPES } from "../../lib/constants";
import { cropIcon, currency, formatDate, formatDuration, shortId } from "../../lib/format";

/**
 * Wholesale buying for verified businesses: multi-line bulk quotes with the
 * farmers' volume tiers applied, ordering on credit terms, invoices, and API
 * keys for connecting a purchasing system.
 */

// ---------------------------------------------------------------------------
function RequestAccess({ account, onRequested }) {
  const toast = useToast();
  const [companyName, setCompanyName] = useState(account.business?.companyName || "");
  const [gstin, setGstin] = useState(account.business?.gstin || "");
  const [busy, setBusy] = useState(false);
  const status = account.business?.status || "none";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await b2b.requestAccount(companyName.trim(), gstin.trim());
      toast.success(r.message);
      onRequested?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto max-w-3xl p-6 sm:p-8">
      <SectionHeader
        eyebrow="Wholesale"
        title="Buy in bulk as a verified business"
        description="Restaurants, retailers and processors get volume prices set by farmers, lower platform fees, credit terms and API access once we verify the business."
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["▦", "Bulk tiers", "Automatic volume pricing on every line"],
          ["🧾", "Credit terms", "Net-15 or net-30 invoices up to your limit"],
          ["⌘", "Partner API", "Quote and order from your own systems"],
        ].map(([icon, title, blurb]) => (
          <div key={title} className="rounded-2xl bg-canvas p-4 ring-1 ring-line">
            <span className="text-xl">{icon}</span>
            <p className="mt-2 text-sm font-bold text-ink">{title}</p>
            <p className="mt-1 text-xs text-ink-soft">{blurb}</p>
          </div>
        ))}
      </div>

      {status === "requested" ? (
        <p className="mt-6 rounded-2xl bg-sky-50 p-4 text-sm text-sky-700 ring-1 ring-sky-100">
          ⏳ Your request for <strong>{account.business.companyName}</strong> (GSTIN{" "}
          {account.business.gstin}) is with our team. You will be able to trade wholesale as soon
          as it is verified.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {status === "declined" && (
            <ErrorNote message="Your previous request was declined. Check the details and try again." />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Registered company name">
              <input className={inputClass} value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
            </Field>
            <Field label="GSTIN" hint="15 characters, e.g. 27AAPFU0939F1ZV">
              <input
                className={`${inputClass} font-mono uppercase`}
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                maxLength={15}
                required
              />
            </Field>
          </div>
          <Button type="submit" loading={busy}>
            Request business account
          </Button>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function QuoteBuilder({ account, onOrdered }) {
  const toast = useToast();
  const { user } = useAuth();
  const minKg = account.minLineQuantityKg;

  const { data: products, loading, error, reload } = useAsyncData(
    () => api.get("/products?inStock=true", { auth: false }),
    { initialData: [] }
  );

  const [search, setSearch] = useState("");
  const [lines, setLines] = useState({}); // productId -> kg (string)
  const [address, setAddress] = useState(user?.location || "");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState("");

  const eligible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => p.quantity >= minKg)
      .filter(
        (p) =>
          !term ||
          p.cropName.toLowerCase().includes(term) ||
          p.location.toLowerCase().includes(term) ||
          p.farmerName.toLowerCase().includes(term)
      );
  }, [products, search, minKg]);

  const items = Object.entries(lines)
    .filter(([, kg]) => Number(kg) > 0)
    .map(([productId, kg]) => ({ productId, quantity: Number(kg) }));

  const setLine = (id, kg) => {
    setQuote(null);
    setLines({ ...lines, [id]: kg });
  };

  const getQuote = async () => {
    setQuoting(true);
    try {
      setQuote(await b2b.quote(items, address.trim()));
    } catch (err) {
      setQuote(null);
      toast.error(err.message);
    } finally {
      setQuoting(false);
    }
  };

  const place = async (paymentMethod) => {
    setPlacing(paymentMethod);
    try {
      const r = await b2b.placeOrder({ items, deliveryAddress: address.trim(), paymentMethod });
      toast.success(r.message);
      setLines({});
      setQuote(null);
      reload({ silent: true });
      onOrdered?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPlacing("");
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card className="p-5 sm:p-6">
        <SectionHeader
          title="Build a bulk order"
          description={`Lines start at ${minKg} kg. Farmers' volume prices apply automatically.`}
          action={
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search crop, city or farmer"
              className="w-56 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          }
        />

        {error && <ErrorNote message={error} onRetry={reload} className="mt-4" />}

        <div className="mt-5 max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <SkeletonCards count={3} />
          ) : eligible.length === 0 ? (
            <EmptyState icon="▦" title="No bulk-sized listings" description={`Nothing in stock with at least ${minKg} kg right now.`} />
          ) : (
            eligible.map((p) => (
              <div key={p._id} className="flex flex-col gap-3 rounded-xl border border-line p-3 sm:flex-row sm:items-center">
                <span className="text-2xl">{cropIcon(p.cropName)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    {p.cropName} <span className="text-xs font-normal text-ink-soft">· {p.farmerName} · {p.location}</span>
                  </p>
                  <p className="fl-numeric text-xs text-ink-soft">
                    {currency(p.pricePerKg)}/kg · {p.quantity} kg available
                    {p.bulkTiers?.length > 0 &&
                      ` · ${p.bulkTiers.map((t) => `${t.minQuantityKg}+ kg ${currency(t.pricePerKg)}`).join(", ")}`}
                    {p.needsRefrigeration ? " · chilled" : ""}
                  </p>
                </div>
                <input
                  type="number"
                  min={minKg}
                  max={p.quantity}
                  step="10"
                  value={lines[p._id] || ""}
                  onChange={(e) => setLine(p._id, e.target.value)}
                  placeholder="kg"
                  aria-label={`Kilograms of ${p.cropName}`}
                  className="w-28 rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-500"
                />
              </div>
            ))
          )}
        </div>
      </Card>

      <aside className="space-y-4">
        <Card className="p-5">
          <Field label="Deliver to">
            <input className={inputClass} value={address} onChange={(e) => { setAddress(e.target.value); setQuote(null); }} />
          </Field>
          <Button className="mt-4 w-full" loading={quoting} disabled={items.length === 0 || !address.trim()} onClick={getQuote}>
            Get quote for {items.length} line{items.length === 1 ? "" : "s"}
          </Button>
        </Card>

        {quote && (
          <Card className="animate-fade-up p-5">
            <p className="fl-eyebrow text-brand-700">Quote · valid {quote.validForMinutes} min</p>
            <ul className="mt-3 space-y-2 text-sm">
              {quote.lines.map((l) => (
                <li key={l.productId} className="flex justify-between gap-3">
                  <span className="text-ink-soft">
                    {l.quantity} kg {l.cropName}
                    {l.bulkTierApplied && <Badge tone="brand" className="ml-1.5 px-2 py-0 text-[10px]">bulk</Badge>}
                  </span>
                  <span className="fl-numeric font-medium text-ink">{currency(l.totalPrice)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
              {quote.bulkSavings > 0 && (
                <div className="flex justify-between text-brand-700">
                  <span>Volume savings</span>
                  <span className="fl-numeric font-semibold">− {currency(quote.bulkSavings)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-soft">Delivery ({quote.delivery?.chosen?.providerName || "partner"})</span>
                <span className="fl-numeric">{currency(quote.charges.deliveryFee)}</span>
              </div>
              {quote.delivery?.distanceKm != null && (
                <p className="fl-numeric text-xs text-ink-faint">
                  {quote.delivery.distanceKm} km · ~{formatDuration(quote.delivery.durationMin)}
                  {quote.delivery.approximate ? " (estimate)" : ""}
                </p>
              )}
              <div className="flex justify-between pt-1 text-base">
                <span className="font-bold text-ink">Total</span>
                <span className="fl-numeric font-bold text-ink">{currency(quote.charges.grandTotal)}</span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <Button
                className="w-full"
                loading={placing === "Invoice"}
                disabled={!quote.credit.canUseInvoice || !!placing}
                onClick={() => place("Invoice")}
              >
                Order on {quote.credit.terms} invoice
              </Button>
              {!quote.credit.canUseInvoice && (
                <p className="text-xs text-ink-soft">{quote.credit.reason}</p>
              )}
              <Button variant="outline" className="w-full" loading={placing === "UPI"} disabled={!!placing} onClick={() => place("UPI")}>
                Pay now (UPI) & order
              </Button>
            </div>
          </Card>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Invoices() {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsyncData(() => b2b.invoices(), {
    initialData: { invoices: [], credit: null },
  });
  const [paying, setPaying] = useState(null);

  const pay = async (invoice) => {
    setPaying(invoice.orderId);
    try {
      const r = await b2b.payInvoice(invoice.orderId);
      toast.success(r.message);
      reload({ silent: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPaying(null);
    }
  };

  if (loading) return <SkeletonCards count={3} />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const tone = { open: "sky", overdue: "rose", paid: "brand", void: "neutral" };

  return (
    <div className="space-y-6">
      {data.credit && (
        <section className="grid gap-4 sm:grid-cols-3">
          <StatCard icon="🧾" tone="blue" label="Credit limit" value={currency(data.credit.limit)} hint={data.credit.terms} />
          <StatCard icon="⏳" tone="amber" label="Outstanding" value={currency(data.credit.exposure)} />
          <StatCard icon="✓" tone="emerald" label="Available" value={currency(data.credit.available)} />
        </section>
      )}

      {data.invoices.length === 0 ? (
        <EmptyState icon="🧾" title="No invoices yet" description="Orders placed on credit terms appear here with their due dates." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.invoices.map((inv) => (
                <tr key={inv.orderId}>
                  <td className="px-4 py-3 font-mono text-xs text-ink">{inv.number}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">
                    <button className="font-semibold text-brand-700 hover:underline" onClick={() => navigate("/orders")}>
                      {shortId(inv.orderId)}
                    </button>{" "}
                    · {inv.orderStatus}
                  </td>
                  <td className="fl-numeric px-4 py-3 font-semibold text-ink">{currency(inv.amount)}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{formatDate(inv.dueAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={tone[inv.state]}>{inv.state}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {["open", "overdue"].includes(inv.state) && (
                      <Button size="sm" loading={paying === inv.orderId} onClick={() => pay(inv)}>
                        Pay
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-faint">
        Payments here use FarmLink's demo payment rail — no real money moves. Paid invoices are held
        in escrow until the delivery is confirmed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ApiKeys() {
  const toast = useToast();
  const { data, setData, loading, error, reload } = useAsyncData(() => b2b.apiKeys(), {
    initialData: { keys: [], scopes: [] },
  });
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(API_SCOPES.map((s) => s.value));
  const [rate, setRate] = useState("60");
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await b2b.createApiKey({ name: name.trim(), scopes, rateLimitPerMinute: Number(rate) });
      setFresh(r.key);
      setName("");
      setData({ ...data, keys: [r.apiKey, ...data.keys] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key) => {
    try {
      const r = await b2b.revokeApiKey(key.id);
      setData({ ...data, keys: data.keys.map((k) => (k.id === key.id ? r.apiKey : k)) });
      toast.success(r.message);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <SkeletonCards count={2} />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const base = API_BASE.replace(/\/api$/, "/api/v1");

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-4">
        {fresh && (
          <div className="animate-fade-up rounded-2xl bg-soil-900 p-5 text-white">
            <p className="text-sm font-bold">Copy this key now — it will not be shown again.</p>
            <code className="mt-3 block break-all rounded-xl bg-white/10 p-3 font-mono text-xs">{fresh}</code>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  navigator.clipboard?.writeText(fresh);
                  toast.success("Key copied.");
                }}
              >
                Copy
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setFresh(null)}>
                I have saved it
              </Button>
            </div>
          </div>
        )}

        {data.keys.length === 0 ? (
          <EmptyState icon="⌘" title="No API keys" description="Create a key to quote and order from your purchasing system." />
        ) : (
          data.keys.map((k) => (
            <Card key={k.id} className={`p-4 ${k.revoked ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{k.name}</p>
                  <p className="font-mono text-xs text-ink-soft">{k.prefix}_••••</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {k.scopes.join(", ")} · {k.rateLimitPerMinute}/min · {k.usageCount} calls
                    {k.lastUsedAt ? ` · last used ${formatDate(k.lastUsedAt)}` : " · never used"}
                  </p>
                </div>
                {k.revoked ? (
                  <Badge tone="neutral">Revoked</Badge>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => revoke(k)}>
                    Revoke
                  </Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <p className="font-bold text-ink">New API key</p>
          <form onSubmit={create} className="mt-3 space-y-3">
            <Field label="Name">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ERP production" required />
            </Field>
            <div>
              <span className="text-sm font-semibold text-ink">Permissions</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {API_SCOPES.map((s) => (
                  <label key={s.value} className="flex items-center gap-2 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={scopes.includes(s.value)}
                      onChange={(e) =>
                        setScopes(e.target.checked ? [...scopes, s.value] : scopes.filter((x) => x !== s.value))
                      }
                      className="h-4 w-4 accent-brand-600"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Requests per minute">
              <input className={inputClass} type="number" min="1" max="600" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Button type="submit" loading={busy} disabled={scopes.length === 0}>
              Create key
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <p className="font-bold text-ink">Quick start</p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-soil-900 p-3 text-[11px] leading-5 text-white/85">
{`curl ${base}/products?crop=tomato \\
  -H "X-API-Key: fl_live_…"

curl -X POST ${base}/orders \\
  -H "X-API-Key: fl_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[{"productId":"…","quantity":200}],
       "deliveryAddress":"Gurgaon",
       "paymentMethod":"Invoice"}'`}
          </pre>
          <p className="mt-2 text-xs text-ink-faint">
            Endpoints: GET /products · POST /quotes · POST /orders · GET /orders · GET /orders/:id
          </p>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function Wholesale() {
  const [tab, setTab] = useState("order");
  const { data: account, loading, error, reload } = useAsyncData(() => b2b.account());

  const verified = account?.accountType === "business" && account?.business?.status === "approved";

  return (
    <AppShell
      title="Wholesale"
      subtitle={verified ? account.business.companyName : "Bulk buying for businesses"}
      actions={
        verified && (
          <Badge tone="brand">
            Business fees · {account.fees.commissionPct}% / {account.fees.logisticsMarkupPct}%
          </Badge>
        )
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} className="mb-6" />}

      {loading ? (
        <SkeletonCards count={3} />
      ) : !account ? null : !verified ? (
        <RequestAccess account={account} onRequested={reload} />
      ) : (
        <>
          <div className="mb-6">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: "order", label: "Bulk order" },
                { value: "invoices", label: "Invoices" },
                { value: "api", label: "API keys" },
              ]}
            />
          </div>
          {tab === "order" && <QuoteBuilder account={account} onOrdered={() => reload({ silent: true })} />}
          {tab === "invoices" && <Invoices />}
          {tab === "api" && <ApiKeys />}
        </>
      )}
    </AppShell>
  );
}
