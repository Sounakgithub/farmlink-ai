import { Link, useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import DemandPanel from "../../components/DemandPanel";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  SectionHeader,
  SkeletonCards,
  SkeletonRows,
  StatCard,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAuth } from "../../context/AuthContext";
import {
  currency,
  cropIcon,
  formatDate,
  shortId,
  statusLabel,
  statusStyle,
} from "../../lib/format";

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Monthly revenue from this farmer's delivered order lines.
 * Real data only: an order counts in the month it was placed, and only the
 * lines belonging to this farmer are counted.
 */
function monthlySales(orders) {
  const now = new Date();
  const buckets = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { label: MONTH_LABEL[d.getMonth()], total: 0 };
  });

  for (const order of orders) {
    if (order.status !== "Delivered") continue;
    const placed = new Date(order.createdAt);
    const back =
      (now.getFullYear() - placed.getFullYear()) * 12 +
      (now.getMonth() - placed.getMonth());
    if (back >= 0 && back < 6) buckets[5 - back].total += order.totalAmount;
  }

  return buckets;
}

/** A labelled bar chart. Pure SVG-free CSS — no charting dependency. */
function SalesChart({ data }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const hasAny = data.some((d) => d.total > 0);

  if (!hasAny) {
    return (
      <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-line-strong text-center">
        <p className="text-sm font-semibold text-ink-soft">No delivered sales yet</p>
        <p className="mt-1 text-xs text-ink-faint">
          Revenue appears here once your first order is delivered.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-40 items-end gap-2.5 sm:gap-4">
      {data.map((bucket, index) => (
        <div key={index} className="group flex flex-1 flex-col items-center gap-2">
          <span className="fl-numeric text-[10px] font-bold text-ink-soft opacity-0 transition-opacity group-hover:opacity-100">
            {currency(bucket.total)}
          </span>

          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full origin-bottom rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400 transition-all duration-300 group-hover:from-brand-700 group-hover:to-brand-500"
              style={{
                height: `${Math.max(4, (bucket.total / max) * 100)}%`,
                animation: "fl-grow-bar .6s var(--ease-out-soft) both",
                animationDelay: `${index * 70}ms`,
              }}
            />
          </div>

          <span className="text-[11px] font-medium text-ink-faint">
            {bucket.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function FarmerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data, loading, error, reload } = useAsyncData(
    async () => {
      const [stats, products, orders] = await Promise.all([
        api.get("/products/stats"),
        api.get("/products/mine"),
        api.get("/orders"),
      ]);
      return { stats, products, orders };
    },
    { initialData: { stats: null, products: [], orders: [] } }
  );

  const { stats, products, orders } = data;

  const pending = orders.filter((o) => o.status === "Pending");
  const recentOrders = orders.slice(0, 5);
  const sales = monthlySales(orders);

  // Month-on-month movement, shown only when there is a previous month to
  // compare against — otherwise the percentage would be meaningless.
  const thisMonth = sales[5].total;
  const lastMonth = sales[4].total;
  const trend =
    lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10 : undefined;

  const lowStock = products.filter((p) => p.quantity > 0 && p.quantity < 50);
  const soldOut = products.filter((p) => p.quantity <= 0);

  return (
    <AppShell
      title={`Good day, ${user?.name?.split(" ")[0] || "Farmer"}`}
      subtitle="Your harvest, orders and earnings at a glance"
      actions={
        <Button
          onClick={() => navigate("/farmer/products")}
          className="whitespace-nowrap"
        >
          + Add crop
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} className="mb-6" />}

      <div className="space-y-10">
        {/* ---------------- action required ---------------- */}
        {pending.length > 0 && (
          <Link to="/farmer/orders" className="block">
            <div className="group relative overflow-hidden rounded-2xl border border-harvest-300/70 bg-gradient-to-br from-harvest-50 to-white p-5 transition-transform duration-300 hover:-translate-y-0.5 sm:p-6">
              <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-harvest-400/15 blur-2xl" />

              <div className="relative flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-harvest-400/20 text-xl ring-1 ring-harvest-300 animate-pulse-ring">
                    ⏳
                  </span>
                  <div>
                    <p className="fl-eyebrow text-harvest-700">Waiting on you</p>
                    <p className="mt-1 text-lg font-bold text-ink">
                      {pending.length} order{pending.length === 1 ? "" : "s"} to
                      accept or reject
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {pending
                        .slice(0, 2)
                        .map((o) => o.products.map((p) => p.cropName).join(", "))
                        .join(" · ")}
                      {pending.length > 2 ? ` · +${pending.length - 2} more` : ""}
                    </p>
                  </div>
                </div>

                <span className="inline-flex items-center gap-2 rounded-xl bg-harvest-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors group-hover:bg-harvest-700">
                  Review orders
                  <span className="transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </span>
              </div>
            </div>
          </Link>
        )}

        {/* ---------------- stats ---------------- */}
        {loading ? (
          <SkeletonCards count={4} />
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="◈"
              tone="amber"
              label="Earnings"
              value={currency(stats?.earnings ?? 0)}
              hint="From delivered orders"
              trend={trend}
              series={sales.map((s) => s.total)}
            />
            <StatCard
              icon="❦"
              tone="emerald"
              label="Listed crops"
              value={stats?.totalProducts ?? 0}
              hint={`${(stats?.totalStockKg ?? 0).toLocaleString("en-IN")} kg in stock`}
            />
            <StatCard
              icon="✦"
              tone="blue"
              label="Active orders"
              value={stats?.activeOrders ?? 0}
              hint="Awaiting action or delivery"
            />
            <StatCard
              icon="➔"
              tone="purple"
              label="Out for delivery"
              value={stats?.pendingDeliveries ?? 0}
              hint="Accepted or in transit"
            />
          </section>
        )}

        {/* ---------------- sales + demand ---------------- */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="p-5 sm:p-6 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="fl-eyebrow text-brand-700">Revenue</p>
                <p className="fl-numeric mt-2 text-3xl font-bold text-ink sm:text-4xl">
                  {currency(thisMonth)}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  This month
                  {trend !== undefined && (
                    <span
                      className={`ml-2 font-bold ${
                        trend >= 0 ? "text-brand-700" : "text-rose-600"
                      }`}
                    >
                      {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
                    </span>
                  )}
                </p>
              </div>

              <Badge tone="neutral">Last 6 months</Badge>
            </div>

            <div className="mt-6">
              <SalesChart data={sales} />
            </div>
          </Card>

          <div className="xl:col-span-1">
            <DemandPanel defaultLocation={user?.location || "Delhi"} />
          </div>
        </div>

        {/* ---------------- orders + inventory ---------------- */}
        <div className="grid gap-6 xl:grid-cols-3">
          <section className="xl:col-span-2">
            <SectionHeader
              title="Recent orders"
              description="Orders that include your crops"
              action={
                <Button as={Link} to="/farmer/orders" variant="ghost" size="sm">
                  View all →
                </Button>
              }
            />

            <div className="mt-5">
              {loading ? (
                <SkeletonRows count={4} />
              ) : recentOrders.length === 0 ? (
                <EmptyState
                  icon="✦"
                  title="No orders yet"
                  description="Once a buyer orders one of your crops it will appear here, ready to accept."
                  action={
                    <Button as={Link} to="/farmer/products">
                      Manage my crops
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {recentOrders.map((order, index) => (
                    <Card
                      as={Link}
                      to="/farmer/orders"
                      key={order._id}
                      interactive
                      className="animate-fade-up flex items-center justify-between gap-3 p-4"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xl ring-1 ring-brand-100">
                          {cropIcon(order.products[0]?.cropName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-bold text-ink">
                            {order.products.map((p) => p.cropName).join(", ")}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-soft">
                            {shortId(order._id)} · {order.buyerName} ·{" "}
                            {formatDate(order.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="fl-numeric font-bold text-ink">
                          {currency(order.totalAmount)}
                        </p>
                        <Badge className={`mt-1 ${statusStyle(order.status)}`}>
                          {statusLabel(order.status)}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Inventory health */}
          <Card className="h-fit p-5">
            <h3 className="text-base font-bold text-ink">Inventory</h3>
            <p className="mt-1 text-xs text-ink-soft">
              {products.length} crop{products.length === 1 ? "" : "s"} listed
            </p>

            {loading ? (
              <div className="mt-4 space-y-2">
                <div className="fl-skeleton h-12 rounded-xl" />
                <div className="fl-skeleton h-12 rounded-xl" />
              </div>
            ) : products.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-line-strong p-5 text-center">
                <p className="text-sm text-ink-soft">Nothing listed yet.</p>
                <Button
                  as={Link}
                  to="/farmer/products"
                  size="sm"
                  className="mt-3"
                >
                  Add your first crop
                </Button>
              </div>
            ) : (
              <>
                {(soldOut.length > 0 || lowStock.length > 0) && (
                  <div className="mt-4 space-y-2">
                    {soldOut.length > 0 && (
                      <div className="flex items-center gap-2.5 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-100">
                        <span>●</span>
                        {soldOut.length} sold out — restock to keep selling
                      </div>
                    )}
                    {lowStock.length > 0 && (
                      <div className="flex items-center gap-2.5 rounded-xl bg-harvest-50 px-3 py-2.5 text-xs font-semibold text-harvest-700 ring-1 ring-harvest-100">
                        <span>●</span>
                        {lowStock.length} running low (under 50 kg)
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {products.slice(0, 5).map((product) => {
                    const out = product.quantity <= 0;
                    return (
                      <Link
                        key={product._id}
                        to="/farmer/products"
                        className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-2.5 transition-colors hover:border-brand-200 hover:bg-brand-50/50"
                      >
                        <span className="text-lg">{cropIcon(product.cropName)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {product.cropName}
                          </p>
                          <p className="fl-numeric text-xs text-ink-faint">
                            {product.quantity} {product.unit} ·{" "}
                            {currency(product.pricePerKg)}/kg
                          </p>
                        </div>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            out
                              ? "bg-rose-500"
                              : product.quantity < 50
                                ? "bg-harvest-500"
                                : "bg-brand-500"
                          }`}
                        />
                      </Link>
                    );
                  })}
                </div>

                <Button
                  as={Link}
                  to="/farmer/products"
                  variant="outline"
                  className="mt-4 w-full"
                >
                  Manage crops
                </Button>
              </>
            )}
          </Card>
        </div>

        {/* ---------------- AI entry ---------------- */}
        <section className="grid gap-5 md:grid-cols-2">
          {[
            {
              to: "/farmer/buyer-matches",
              eyebrow: "◎ Buyer matching",
              title: "Find the best buyers for your crops",
              body: "Ranked on crop fit, distance, price, quantity, demand outlook and track record — each with its reasoning and its limits.",
            },
            {
              to: "/insights",
              eyebrow: "◈ AI insights",
              title: "Price it right, plant what sells",
              body: "A price advisor that explains every rupee, and demand forecasts across the coming months.",
            },
          ].map((panel) => (
            <Link key={panel.to} to={panel.to} className="group block">
              <div className="fl-soil relative h-full overflow-hidden rounded-2xl p-6 transition-transform duration-300 group-hover:-translate-y-1">
                <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-40" />
                <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-brand-500/15 blur-3xl transition-opacity duration-300 group-hover:opacity-150" />

                <div className="relative">
                  <p className="fl-eyebrow text-brand-400">{panel.eyebrow}</p>
                  <h3 className="mt-3 text-lg font-bold tracking-tight text-white">
                    {panel.title}
                  </h3>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">
                    {panel.body}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-300">
                    Open
                    <span className="transition-transform duration-200 group-hover:translate-x-1">
                      →
                    </span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
