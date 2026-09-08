import { Link, useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import DemandPanel from "../../components/DemandPanel";
import { Badge, Button, EmptyState, ErrorNote, Spinner, StatCard } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useToast } from "../../context/ToastContext";
import {
  currency,
  cropIcon,
  formatDate,
  shortId,
  statusLabel,
  statusStyle,
} from "../../lib/format";

export default function BuyerDashboard() {
  const { user } = useAuth();
  const { addToCart, itemCount } = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const { data, loading, error, reload } = useAsyncData(
    async () => {
      const [stats, orders, products] = await Promise.all([
        api.get("/orders/stats"),
        api.get("/orders"),
        api.get("/products?inStock=true", { auth: false }),
      ]);
      return { stats, orders, products };
    },
    { initialData: { stats: null, orders: [], products: [] } }
  );

  const { stats, orders, products } = data;

  return (
    <AppShell
      title={`Welcome, ${user?.name?.split(" ")[0] || "there"}! 🧑‍🍳`}
      subtitle="Fresh produce direct from farmers"
      actions={
        <Button onClick={() => navigate("/market")} className="whitespace-nowrap">
          🛒 Shop now
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <Spinner label="Loading your dashboard…" />
      ) : (
        <div className="space-y-8">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="📦"
              tone="emerald"
              label="Total orders"
              value={stats?.total ?? 0}
              hint="All time"
            />
            <StatCard
              icon="🚚"
              tone="blue"
              label="In progress"
              value={stats?.active ?? 0}
              hint="Pending or on the way"
            />
            <StatCard
              icon="✓"
              tone="purple"
              label="Delivered"
              value={stats?.delivered ?? 0}
              hint="Completed orders"
            />
            <StatCard
              icon="💰"
              tone="amber"
              label="Total spent"
              value={currency(stats?.completedValue ?? 0)}
              hint="On delivered orders"
            />
          </section>

          <div className="grid gap-6 xl:grid-cols-3">
            {/* Recent orders */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 xl:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                    Recent orders
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Your latest purchases
                  </p>
                </div>

                <Link
                  to="/orders"
                  className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  View all →
                </Link>
              </div>

              {orders.length === 0 ? (
                <div className="mt-6">
                  <EmptyState
                    icon="📦"
                    title="No orders yet"
                    description="Browse the marketplace and place your first order."
                    action={
                      <Button onClick={() => navigate("/market")}>
                        Browse the marketplace
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {orders.slice(0, 5).map((order) => (
                    <Link
                      key={order._id}
                      to="/orders"
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
                            {shortId(order._id)} · {formatDate(order.createdAt)}
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

            {/* Shared AI feature */}
            <div className="xl:col-span-1">
              <DemandPanel defaultLocation={user?.location || "Delhi"} limit={6} />
            </div>
          </div>

          {/* Fresh picks */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 sm:text-xl">
                  Fresh from the farm
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {itemCount > 0
                    ? `${itemCount} item${itemCount === 1 ? "" : "s"} already in your cart`
                    : "Newly listed produce"}
                </p>
              </div>

              <Link
                to="/market"
                className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
              >
                See all →
              </Link>
            </div>

            {products.length === 0 ? (
              <div className="mt-6">
                <EmptyState
                  title="Nothing listed right now"
                  description="Check back soon — farmers add fresh produce every day."
                />
              </div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {products.slice(0, 8).map((product) => (
                  <div
                    key={product._id}
                    className="flex flex-col rounded-xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <span className="text-3xl">{cropIcon(product.cropName)}</span>

                    <h3 className="mt-3 font-bold text-slate-900">
                      {product.cropName}
                    </h3>
                    <p className="mt-1 flex-1 text-xs text-slate-500">
                      👨‍🌾 {product.farmerName} · 📍 {product.location}
                    </p>

                    <p className="mt-2 font-bold text-emerald-600">
                      {currency(product.pricePerKg)}
                      <span className="text-xs font-normal text-slate-500"> / kg</span>
                    </p>

                    <Button
                      className="mt-3 w-full"
                      onClick={() => {
                        addToCart(product, 1);
                        toast.success(`${product.cropName} added to your cart.`);
                      }}
                    >
                      🛒 Add
                    </Button>
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
