import { useState } from "react";
import AppShell from "../../components/AppShell";
import StartChatButton from "../../components/StartChatButton";
import OrderOperations from "../../components/OrderOperations";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  SkeletonRows,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useToast } from "../../context/ToastContext";
import {
  currency,
  cropIcon,
  formatDate,
  shortId,
  statusLabel,
  statusStyle,
} from "../../lib/format";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "Pending", label: "Needs action" },
  { key: "Accepted", label: "Accepted" },
  { key: "In Transit", label: "In transit" },
  { key: "Delivered", label: "Delivered" },
];

export default function FarmerOrders() {
  const toast = useToast();

  const {
    data: orders,
    setData: setOrders,
    loading,
    error,
    reload,
  } = useAsyncData(() => api.get("/orders"), { initialData: [] });

  const [filter, setFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);

  const updateStatus = async (orderId, status) => {
    setBusyId(orderId);
    try {
      const data = await api.patch(`/orders/${orderId}/status`, { status });
      setOrders((current) =>
        current.map((o) => (o._id === orderId ? data.order : o))
      );
      toast.success(data.message);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const visible =
    filter === "all" ? orders : orders.filter((o) => o.status === filter);

  const pendingCount = orders.filter((o) => o.status === "Pending").length;

  return (
    <AppShell
      title="Incoming orders"
      subtitle={
        pendingCount > 0
          ? `${pendingCount} order${pendingCount === 1 ? "" : "s"} waiting for your response`
          : "Orders that include your crops"
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {/* Filters */}
      <div className="fl-scrollbar-none -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => {
          const count =
            f.key === "all"
              ? orders.length
              : orders.filter((o) => o.status === f.key).length;
          const active = filter === f.key;

          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
                active
                  ? "border-brand-600 bg-brand-600 text-white shadow-[0_4px_14px_-4px_rgba(22,163,74,.6)]"
                  : "border-line bg-surface text-ink-soft hover:border-brand-200 hover:text-ink"
              }`}
            >
              {f.label}
              {count > 0 && (
                <span
                  className={`fl-numeric rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active
                      ? "bg-white/20 text-white"
                      : f.key === "Pending"
                        ? "bg-harvest-100 text-harvest-700"
                        : "bg-canvas text-ink-faint"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <SkeletonRows count={4} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="✦"
          title={filter === "all" ? "No orders yet" : "Nothing in this filter"}
          description={
            filter === "all"
              ? "When a buyer orders one of your crops it will appear here."
              : "Try a different filter to see your other orders."
          }
        />
      ) : (
        <div className="space-y-5">
          {visible.map((order) => (
            <Card
              key={order._id}
              className={`animate-fade-up overflow-hidden ${
                order.status === "Pending" ? "ring-2 ring-harvest-300/60" : ""
              }`}
            >
              <header className="flex flex-col gap-3 border-b border-line bg-canvas px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="fl-eyebrow text-ink-faint">
                    Order {shortId(order._id)}
                  </p>
                  <h3 className="mt-1 font-bold text-ink">
                    {order.buyerName}
                  </h3>
                  <p className="text-xs text-ink-soft">
                    {formatDate(order.createdAt)}
                    {order.deliveryAddress ? ` · ${order.deliveryAddress}` : ""}
                  </p>
                </div>

                <Badge
                  className={statusStyle(order.status)}
                  pulse={order.status === "Pending"}
                >
                  {statusLabel(order.status)}
                </Badge>
              </header>

              <div className="px-5 py-4">
                <div className="space-y-3">
                  {order.products.map((line, index) => (
                    <div
                      key={`${order._id}-${index}`}
                      className="flex flex-col gap-2 rounded-xl border border-line bg-canvas p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{cropIcon(line.cropName)}</span>
                        <div>
                          <p className="font-semibold text-ink">
                            {line.cropName}
                          </p>
                          <p className="fl-numeric text-xs text-ink-soft">
                            {line.quantity} kg × {currency(line.pricePerKg)}/kg
                          </p>
                        </div>
                      </div>

                      <span className="fl-numeric font-bold text-ink">
                        {currency(line.totalPrice)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs text-ink-faint">
                      {order.charges?.payout != null
                        ? `Your payout (after ${order.charges.commissionPct}% commission)`
                        : "Your earnings from this order"}
                    </p>
                    <p className="fl-numeric text-2xl font-bold text-ink">
                      {currency(order.charges?.payout ?? order.totalAmount)}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {!["Rejected", "Cancelled"].includes(order.status) && (
                      <StartChatButton
                        kind="buyer-farmer"
                        orderId={order._id}
                        label={`💬 ${order.buyerName}`}
                        variant="outline"
                      />
                    )}

                    {order.status === "Pending" && (
                      <>
                        <Button
                          variant="danger"
                          disabled={busyId === order._id}
                          onClick={() => updateStatus(order._id, "Rejected")}
                        >
                          ✕ Reject
                        </Button>

                        <Button
                          loading={busyId === order._id}
                          onClick={() => updateStatus(order._id, "Accepted")}
                        >
                          ✓ Accept order
                        </Button>
                      </>
                    )}

                    {order.status === "Accepted" && (
                      <span className="inline-flex items-center gap-2 rounded-xl bg-canvas px-3.5 py-2 text-sm text-ink-soft ring-1 ring-line">
                        <span className="h-1.5 w-1.5 rounded-full bg-harvest-500" />
                        {order.logistics?.mode === "offered"
                          ? `Offered to ${order.logistics.providerName}`
                          : order.logistics?.mode === "provider"
                            ? `${order.logistics.providerName} will collect · keep produce ready for inspection`
                            : "Waiting for a driver to collect"}
                      </span>
                    )}

                    {order.status === "In Transit" && (
                      <span className="inline-flex items-center gap-2 rounded-xl bg-sky-50 px-3.5 py-2 text-sm font-semibold text-sky-700 ring-1 ring-sky-100">
                        🚚 On the way to the buyer
                      </span>
                    )}
                  </div>
                </div>

                {order.status !== "Pending" && (
                  <div className="mt-4">
                    <OrderOperations
                      orderId={order._id}
                      orderedKg={order.products.reduce((s, l) => s + l.quantity, 0)}
                    />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
