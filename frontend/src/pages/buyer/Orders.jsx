import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import OrderTracking from "../../components/OrderTracking";
import StartChatButton from "../../components/StartChatButton";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorNote,
  Spinner,
} from "../../components/ui";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
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

function paymentBadge(order) {
  const method = order.paymentMethod || "Cash on Delivery";
  if (order.paymentStatus === "Paid")
    return {
      text: `✓ Paid · ${method}`,
      cls: "bg-green-100 text-green-700",
    };
  if (order.paymentStatus === "Refunded")
    return { text: "↩ Refunded", cls: "bg-slate-100 text-slate-600" };
  return {
    text: `${method} · due on delivery`,
    cls: "bg-amber-100 text-amber-700",
  };
}

export default function Orders() {
  const navigate = useNavigate();
  const toast = useToast();
  const { addToCart } = useCart();

  const {
    data: orders,
    setData: setOrders,
    loading,
    error,
    reload,
  } = useAsyncData(() => api.get("/orders"), { initialData: [] });

  const [cancelling, setCancelling] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  // Keep live deliveries fresh without flashing the spinner.
  useEffect(() => {
    const timer = setInterval(() => reload({ silent: true }), 8000);
    return () => clearInterval(timer);
  }, [reload]);

  const handleCancel = async () => {
    setCancelBusy(true);
    try {
      const data = await api.patch(`/orders/${cancelling._id}/cancel`);
      setOrders((current) =>
        current.map((o) => (o._id === cancelling._id ? data.order : o))
      );
      toast.success("Order cancelled.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancelBusy(false);
      setCancelling(null);
    }
  };

  const reorder = (order) => {
    order.products.forEach((line) => {
      addToCart(
        {
          _id: line.productId,
          cropName: line.cropName,
          farmerName: line.farmerName,
          farmerId: line.farmerId,
          location: line.location,
          pricePerKg: line.pricePerKg,
          unit: "kg",
          quantity: line.quantity,
        },
        line.quantity
      );
    });
    toast.success("Items added to your cart.");
    navigate("/cart");
  };

  return (
    <AppShell
      title="My orders"
      subtitle="Track your purchases from farm to door"
      actions={
        <Button
          variant="secondary"
          onClick={() => navigate("/market")}
          className="whitespace-nowrap"
        >
          🛒 Marketplace
        </Button>
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading ? (
        <Spinner label="Loading your orders…" />
      ) : orders.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No orders yet"
          description="Your purchases from farmers will appear here."
          action={<Button onClick={() => navigate("/market")}>Browse the marketplace</Button>}
        />
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const canCancel = ["Pending", "Accepted", "Confirmed"].includes(
              order.status
            );
            const closed = ["Delivered", "Cancelled", "Rejected"].includes(
              order.status
            );
            const pay = paymentBadge(order);
            const uniqueFarmers = [
              ...new Map(
                order.products.map((l) => [String(l.farmerId), l])
              ).values(),
            ];

            return (
              <article
                key={order._id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <header className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Order {shortId(order._id)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatDate(order.createdAt)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge className={pay.cls}>{pay.text}</Badge>
                    <Badge className={statusStyle(order.status)}>
                      {statusLabel(order.status)}
                    </Badge>
                  </div>
                </header>

                <div className="px-5 py-4">
                  <div className="space-y-3">
                    {order.products.map((line, index) => (
                      <div
                        key={`${order._id}-${index}`}
                        className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{cropIcon(line.cropName)}</span>
                          <div>
                            <p className="font-semibold text-slate-900">
                              {line.cropName}
                            </p>
                            <p className="text-xs text-slate-500">
                              👨‍🌾 {line.farmerName}
                              {line.location ? ` · ${line.location}` : ""}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 text-sm">
                          <div>
                            <p className="text-xs text-slate-400">Qty</p>
                            <p className="font-semibold">{line.quantity} kg</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Rate</p>
                            <p className="font-semibold">
                              {currency(line.pricePerKg)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400">Total</p>
                            <p className="font-bold text-emerald-600">
                              {currency(line.totalPrice)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {order.deliveryInstructions && (
                    <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                      📝 Delivery note: {order.deliveryInstructions}
                    </p>
                  )}

                  {/* Talk to the people on this order */}
                  {!closed && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {uniqueFarmers.map((line) => (
                        <StartChatButton
                          key={String(line.farmerId)}
                          kind="buyer-farmer"
                          orderId={order._id}
                          label={`💬 ${line.farmerName}`}
                          variant="outline"
                        />
                      ))}

                      {order.driver && order.status === "In Transit" && (
                        <StartChatButton
                          kind="buyer-driver"
                          orderId={order._id}
                          label={`💬 ${order.driver.name} (driver)`}
                          variant="outline"
                        />
                      )}
                    </div>
                  )}

                  {/* Full journey tracking: farm -> driver -> your address.
                      Available from the moment the order is accepted, not just
                      once a driver happens to be pinging a GPS position. */}
                  {["Accepted", "Confirmed", "In Transit", "Delivered"].includes(
                    order.status
                  ) && (
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      {order.driver?.phone && (
                        <p className="mb-3 text-xs text-slate-500">
                          🚚 {order.driver.name} · 📞 {order.driver.phone}
                        </p>
                      )}

                      <OrderTracking orderId={order._id} status={order.status} />
                    </div>
                  )}

                  <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs text-slate-400">Order total</p>
                      <p className="text-2xl font-bold text-emerald-600">
                        {currency(order.totalAmount)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {closed && (
                        <Button variant="secondary" onClick={() => reorder(order)}>
                          ↻ Reorder
                        </Button>
                      )}
                      {canCancel && (
                        <Button
                          variant="danger"
                          onClick={() => setCancelling(order)}
                        >
                          ✕ Cancel order
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!cancelling}
        busy={cancelBusy}
        title="Cancel this order?"
        message="The farmer will be notified and the stock returned to the marketplace. Prepaid orders are refunded."
        confirmLabel="Cancel order"
        onConfirm={handleCancel}
        onCancel={() => setCancelling(null)}
      />
    </AppShell>
  );
}
