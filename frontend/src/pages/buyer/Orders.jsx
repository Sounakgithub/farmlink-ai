import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import AppShell from "../../components/AppShell";
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
import { useToast } from "../../context/ToastContext";
import {
  currency,
  cropIcon,
  formatDate,
  shortId,
  statusLabel,
  statusStyle,
} from "../../lib/format";

const driverIcon = L.divIcon({
  html: "🚚",
  className: "",
  iconSize: [35, 35],
  iconAnchor: [17, 17],
});

export default function Orders() {
  const navigate = useNavigate();
  const toast = useToast();

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

                  <Badge className={statusStyle(order.status)}>
                    {statusLabel(order.status)}
                  </Badge>
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

                  {/* Live driver tracking */}
                  {order.status === "In Transit" && order.driverLocation?.latitude && (
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-emerald-600">
                            LIVE DELIVERY
                          </p>
                          <h4 className="mt-0.5 font-bold text-slate-900">
                            🚚 Track your driver
                          </h4>
                        </div>
                        <Badge className="bg-indigo-100 text-indigo-700">
                          ● Updated {formatDate(order.driverLocation.updatedAt)}
                        </Badge>
                      </div>

                      <MapContainer
                        center={[
                          order.driverLocation.latitude,
                          order.driverLocation.longitude,
                        ]}
                        zoom={14}
                        scrollWheelZoom={false}
                        className="h-64 w-full rounded-xl sm:h-80"
                      >
                        <TileLayer
                          attribution="&copy; OpenStreetMap contributors"
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        <Marker
                          position={[
                            order.driverLocation.latitude,
                            order.driverLocation.longitude,
                          ]}
                          icon={driverIcon}
                        >
                          <Popup>🚚 Your driver is here</Popup>
                        </Marker>
                      </MapContainer>
                    </div>
                  )}

                  <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs text-slate-400">Order total</p>
                      <p className="text-2xl font-bold text-emerald-600">
                        {currency(order.totalAmount)}
                      </p>
                    </div>

                    {canCancel && (
                      <Button variant="danger" onClick={() => setCancelling(order)}>
                        ✕ Cancel order
                      </Button>
                    )}
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
        message="The farmer will be notified and the stock returned to the marketplace."
        confirmLabel="Cancel order"
        onConfirm={handleCancel}
        onCancel={() => setCancelling(null)}
      />
    </AppShell>
  );
}
