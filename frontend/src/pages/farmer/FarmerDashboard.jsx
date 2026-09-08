import { Link, useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import DemandPanel from "../../components/DemandPanel";
import { Badge, Button, EmptyState, ErrorNote, Spinner, StatCard } from "../../components/ui";
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
  const recentOrders = orders.slice(0, 5);

  return (
    <AppShell
      title={`Good day, ${user?.name?.split(" ")[0] || "Farmer"}! 👋`}
      subtitle="Here's what's happening with your farm today."
      actions={
        <Button
          onClick={() => navigate("/farmer/products")}
          className="whitespace-nowrap"
        >
          + Add crop
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <Spinner label="Loading your dashboard…" />
      ) : (
        <div className="space-y-8">
          {/* Stats */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="🌱"
              tone="emerald"
              label="Listed crops"
              value={stats?.totalProducts ?? 0}
              hint={`${(stats?.totalStockKg ?? 0).toLocaleString("en-IN")} kg in stock`}
            />
            <StatCard
              icon="📦"
              tone="blue"
              label="Active orders"
              value={stats?.activeOrders ?? 0}
              hint="Awaiting action or delivery"
            />
            <StatCard
              icon="💰"
              tone="amber"
              label="Earnings"
              value={currency(stats?.earnings ?? 0)}
              hint="From delivered orders"
            />
            <StatCard
              icon="🚚"
              tone="purple"
              label="Out for delivery"
              value={stats?.pendingDeliveries ?? 0}
              hint="Accepted or in transit"
            />
          </section>

          <div className="grid gap-6 xl:grid-cols-3">
            {/* Demand forecast (shared AI feature) */}
            <div className="xl:col-span-1">
              <DemandPanel defaultLocation={user?.location || "Delhi"} />
            </div>

            {/* Recent orders */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                    Recent orders
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Orders that include your crops
                  </p>
                </div>

                <Link
                  to="/farmer/orders"
                  className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  View all →
                </Link>
              </div>

              {recentOrders.length === 0 ? (
                <div className="mt-6">
                  <EmptyState
                    icon="📦"
                    title="No orders yet"
                    description="Once a buyer orders one of your crops it will show up here."
                  />
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {recentOrders.map((order) => (
                    <Link
                      key={order._id}
                      to="/farmer/orders"
                      className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4 transition hover:bg-slate-100 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="text-2xl">
                          {cropIcon(order.products[0]?.cropName)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">
                            {order.products.map((p) => p.cropName).join(", ")}
                          </p>
                          <p className="text-xs text-slate-500">
                            {shortId(order._id)} · {order.buyerName} ·{" "}
                            {formatDate(order.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <span className="font-bold text-emerald-600">
                          {currency(order.totalAmount)}
                        </span>
                        <Badge className={statusStyle(order.status)}>
                          {statusLabel(order.status)}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* My crops preview */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                  Your listed crops
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Only your own listings appear here
                </p>
              </div>

              <Link
                to="/farmer/products"
                className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
              >
                Manage crops →
              </Link>
            </div>

            {products.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="No crops listed yet"
                  description="Add your first crop to start selling on the marketplace."
                  action={
                    <Button onClick={() => navigate("/farmer/products")}>
                      Add your first crop
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {products.slice(0, 8).map((product) => (
                  <div
                    key={product._id}
                    className="rounded-xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-3xl">{cropIcon(product.cropName)}</span>
                      <Badge
                        className={
                          product.quantity > 0
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }
                      >
                        {product.quantity > 0 ? "Live" : "Sold out"}
                      </Badge>
                    </div>

                    <h3 className="mt-3 font-bold text-slate-900">
                      {product.cropName}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {product.quantity} {product.unit} · {product.location}
                    </p>
                    <p className="mt-2 font-bold text-emerald-600">
                      {currency(product.pricePerKg)}
                      <span className="text-xs font-normal text-slate-500"> / kg</span>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
