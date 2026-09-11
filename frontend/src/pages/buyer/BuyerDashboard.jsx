import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import BuyModal from "../../components/BuyModal";
import ProductCard from "../../components/ProductCard";
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
import { useCart } from "../../context/CartContext";
import {
  currency,
  cropIcon,
  formatDate,
  shortId,
  statusLabel,
  statusStyle,
} from "../../lib/format";

const ACTIVE = ["Pending", "Accepted", "Confirmed", "In Transit"];

/** "Good morning" / "Good afternoon" / "Good evening", from the local clock. */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** How far along the chain an order is, for the inline progress rail. */
const STAGE_INDEX = {
  Pending: 0,
  Accepted: 1,
  Confirmed: 1,
  "In Transit": 2,
  Delivered: 3,
};

function OrderProgress({ status }) {
  const reached = STAGE_INDEX[status];
  if (reached === undefined) return null;

  return (
    <div className="mt-3 flex items-center gap-1.5" aria-hidden="true">
      {["Placed", "Accepted", "On the way", "Delivered"].map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-1.5">
          <span
            className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
              i <= reached ? "bg-brand-500" : "bg-line"
            }`}
          />
          {i === reached && status !== "Delivered" && (
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function BuyerDashboard() {
  const { user } = useAuth();
  const { itemCount } = useCart();
  const navigate = useNavigate();

  const [buying, setBuying] = useState(null);

  const { data, loading, error, reload } = useAsyncData(
    async () => {
      const [stats, orders, products, chats] = await Promise.all([
        api.get("/orders/stats"),
        api.get("/orders"),
        api.get("/products?inStock=true", { auth: false }),
        api.get("/conversations"),
      ]);
      return { stats, orders, products, chats };
    },
    { initialData: { stats: null, orders: [], products: [], chats: [] } }
  );

  const { stats, orders, products, chats } = data;

  const liveOrders = orders.filter((o) => ACTIVE.includes(o.status));
  const inTransit = orders.find((o) => o.status === "In Transit");
  const unreadChats = chats.filter((c) => c.unread > 0);

  // Spend over the last six months, for the sparkline on the spend tile.
  const spendSeries = (() => {
    const months = Array.from({ length: 6 }, () => 0);
    const now = new Date();
    for (const order of orders) {
      if (order.status !== "Delivered") continue;
      const placed = new Date(order.createdAt);
      const back =
        (now.getFullYear() - placed.getFullYear()) * 12 +
        (now.getMonth() - placed.getMonth());
      if (back >= 0 && back < 6) months[5 - back] += order.totalAmount;
    }
    return months;
  })();

  return (
    <AppShell
      title={`${greeting()}, ${user?.name?.split(" ")[0] || "there"}`}
      subtitle="Here's what's happening with your farm-to-table orders"
      actions={
        <Button onClick={() => navigate("/market")} className="whitespace-nowrap">
          Shop fresh produce
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} className="mb-6" />}

      <div className="space-y-10">
        {/* ---------------- stats ---------------- */}
        {loading ? (
          <SkeletonCards count={4} />
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon="✦"
              tone="emerald"
              label="Total orders"
              value={stats?.total ?? 0}
              hint="All time"
            />
            <StatCard
              icon="➔"
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
              icon="◈"
              tone="amber"
              label="Total spent"
              value={currency(stats?.completedValue ?? 0)}
              hint="On delivered orders"
              series={spendSeries.some(Boolean) ? spendSeries : undefined}
            />
          </section>
        )}

        {/* ---------------- live delivery banner ---------------- */}
        {inTransit && (
          <Link to="/orders" className="block">
            <div className="fl-soil group relative overflow-hidden rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-0.5">
              <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-50" />
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand-500/20 blur-3xl" />

              <div className="relative flex flex-wrap items-center justify-between gap-5">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/20 text-xl ring-1 ring-brand-400/25 animate-pulse-ring">
                    🚚
                  </span>
                  <div>
                    <p className="fl-eyebrow text-brand-400">Out for delivery</p>
                    <p className="mt-1 text-lg font-bold text-white">
                      {inTransit.products.map((p) => p.cropName).join(", ")}
                    </p>
                    <p className="mt-0.5 text-xs text-white/50">
                      {shortId(inTransit._id)}
                      {inTransit.driver ? ` · ${inTransit.driver.name} is driving` : ""}
                    </p>
                  </div>
                </div>

                <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors group-hover:bg-white/15">
                  Track live
                  <span className="transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </span>
              </div>
            </div>
          </Link>
        )}

        <div className="grid gap-6 xl:grid-cols-3">
          {/* ---------------- recent orders ---------------- */}
          <section className="xl:col-span-2">
            <SectionHeader
              title="Recent orders"
              description="Your latest purchases, newest first"
              action={
                <Button as={Link} to="/orders" variant="ghost" size="sm">
                  View all →
                </Button>
              }
            />

            <div className="mt-5">
              {loading ? (
                <SkeletonRows count={4} />
              ) : orders.length === 0 ? (
                <EmptyState
                  icon="🧺"
                  title="No orders yet"
                  description="Your next harvest delivery will appear here, tracked from the farm to your door."
                  action={
                    <Button onClick={() => navigate("/market")}>
                      Explore produce
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {orders.slice(0, 5).map((order, index) => (
                    <Card
                      as={Link}
                      to="/orders"
                      key={order._id}
                      interactive
                      className="animate-fade-up block p-4"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xl ring-1 ring-brand-100">
                            {cropIcon(order.products[0]?.cropName)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-bold text-ink">
                              {order.products.map((p) => p.cropName).join(", ")}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-ink-soft">
                              {shortId(order._id)} · {formatDate(order.createdAt)}
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
                      </div>

                      <OrderProgress status={order.status} />
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ---------------- side rail ---------------- */}
          <div className="space-y-6">
            {/* AI picks */}
            <Card className="relative overflow-hidden p-5">
              <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-brand-400/12 blur-2xl" />
              <div className="relative">
                <p className="fl-eyebrow text-brand-700">✨ Recommended for you</p>
                <h3 className="mt-2 text-base font-bold text-ink">
                  Produce picked for how you buy
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  Ranked on crop fit, price, distance, demand and each farmer's
                  track record — with the reasoning shown.
                </p>
                <Button
                  as={Link}
                  to="/recommendations"
                  variant="outline"
                  className="mt-4 w-full"
                >
                  See my matches
                </Button>
              </div>
            </Card>

            {/* Deliveries */}
            <Card className="p-5">
              <h3 className="text-base font-bold text-ink">Your deliveries</h3>

              {loading ? (
                <div className="mt-4 space-y-2">
                  <div className="fl-skeleton h-14 rounded-xl" />
                  <div className="fl-skeleton h-14 rounded-xl" />
                </div>
              ) : liveOrders.length === 0 ? (
                <p className="mt-3 text-sm text-ink-soft">
                  Nothing on the way right now.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {liveOrders.slice(0, 3).map((order) => (
                    <Link
                      key={order._id}
                      to="/orders"
                      className="block rounded-xl border border-line bg-canvas p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">
                          {order.products.map((p) => p.cropName).join(", ")}
                        </span>
                        <Badge className={statusStyle(order.status)}>
                          {statusLabel(order.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-faint">
                        {shortId(order._id)}
                        {order.driver ? ` · ${order.driver.name}` : ""}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Messages */}
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-ink">Messages</h3>
                <Link
                  to="/messages"
                  className="text-xs font-bold text-brand-700 transition hover:text-brand-800"
                >
                  Open →
                </Link>
              </div>

              {chats.length === 0 ? (
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                  Ask a farmer about freshness or price from any listing.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {chats.slice(0, 4).map((chat) => (
                    <Link
                      key={chat._id}
                      to={`/messages/${chat._id}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {chat.other?.name}
                        </p>
                        <p className="truncate text-xs text-ink-faint">
                          {chat.lastMessageText || chat.subject}
                        </p>
                      </div>
                      {chat.unread > 0 && (
                        <span className="fl-numeric shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">
                          {chat.unread}
                        </span>
                      )}
                    </Link>
                  ))}
                  {unreadChats.length > 0 && (
                    <p className="pt-1 text-xs font-semibold text-brand-700">
                      {unreadChats.length} conversation
                      {unreadChats.length === 1 ? "" : "s"} need a reply
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* ---------------- fresh picks ---------------- */}
        <section>
          <SectionHeader
            eyebrow="Straight from the field"
            title="Fresh from the farm"
            description={
              itemCount > 0
                ? `${itemCount} kg already in your cart`
                : "Newly listed produce near you"
            }
            action={
              <Button as={Link} to="/market" variant="ghost" size="sm">
                See all →
              </Button>
            }
          />

          <div className="mt-5">
            {loading ? (
              <SkeletonCards count={4} />
            ) : products.length === 0 ? (
              <EmptyState
                icon="🌾"
                title="Nothing listed right now"
                description="Check back soon — farmers add fresh produce every day."
              />
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {products.slice(0, 4).map((product, index) => (
                  <div
                    key={product._id}
                    className="animate-fade-up"
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <ProductCard
                      product={product}
                      viewerLocation={user?.location}
                      onChoose={setBuying}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <BuyModal product={buying} open={!!buying} onClose={() => setBuying(null)} />
    </AppShell>
  );
}
