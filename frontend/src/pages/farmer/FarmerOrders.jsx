import { useState } from "react";
import AppShell from "../../components/AppShell";
import StartChatButton from "../../components/StartChatButton";
import { Badge, Button, EmptyState, ErrorNote, Spinner } from "../../components/ui";
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
      <div className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              filter === f.key
                ? "bg-emerald-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading orders…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="📦"
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
            <article
              key={order._id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <header className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Order {shortId(order._id)}
                  </p>
                  <h3 className="mt-1 font-bold text-slate-900">
                    {order.buyerName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {formatDate(order.createdAt)}
                    {order.deliveryAddress ? ` · ${order.deliveryAddress}` : ""}
                  </p>
                </div>

                <Badge className={statusStyle(order.status)}>
                  {statusLabel(order.status)}
                </Badge>
              </header>

              <div className="px-5 py-4">
                <div className="space-y-3">
                  {order.products.map((line, index) => (
                    <div
                      key={`${order._id}-${index}`}
                      className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{cropIcon(line.cropName)}</span>
                        <div>
                          <p className="font-semibold text-slate-900">
                            {line.cropName}
                          </p>
                          <p className="text-xs text-slate-500">
                            {line.quantity} kg × {currency(line.pricePerKg)}/kg
                          </p>
                        </div>
                      </div>

                      <span className="font-bold text-emerald-600">
                        {currency(line.totalPrice)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs text-slate-400">Your earnings from this order</p>
                    <p className="text-xl font-bold text-emerald-600">
                      {currency(order.totalAmount)}
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
                          disabled={busyId === order._id}
                          onClick={() => updateStatus(order._id, "Accepted")}
                        >
                          {busyId === order._id ? "Working…" : "✓ Accept order"}
                        </Button>
                      </>
                    )}

                    {order.status === "Accepted" && (
                      <p className="text-sm text-slate-500">
                        Waiting for a driver to pick it up.
                      </p>
                    )}

                    {order.status === "In Transit" && (
                      <p className="text-sm text-indigo-600">
                        🚚 On the way to the buyer.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
