import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { Button, EmptyState, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useToast } from "../../context/ToastContext";
import { currency, cropIcon } from "../../lib/format";

export default function Cart() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { cart, totalPrice, itemCount, setQuantity, removeFromCart, clearCart } =
    useCart();

  const [address, setAddress] = useState(user?.location || "");
  const [placing, setPlacing] = useState(false);

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    setPlacing(true);
    try {
      await api.post("/orders", {
        items: cart.map((item) => ({
          productId: item._id,
          quantity: item.cartQuantity,
        })),
        deliveryAddress: address.trim(),
      });

      clearCart();
      toast.success("Order placed! The farmer will confirm it shortly.");
      navigate("/orders");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPlacing(false);
    }
  };

  return (
    <AppShell
      title="Your cart"
      subtitle={`${itemCount} item${itemCount === 1 ? "" : "s"} ready to order`}
      actions={
        <Button
          variant="secondary"
          onClick={() => navigate("/market")}
          className="whitespace-nowrap"
        >
          ← Keep shopping
        </Button>
      }
    >
      {cart.length === 0 ? (
        <EmptyState
          icon="🧺"
          title="Your cart is empty"
          description="Browse fresh produce from farmers near you and add it to your cart."
          action={<Button onClick={() => navigate("/market")}>Browse the marketplace</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Items */}
          <section className="space-y-4 lg:col-span-2">
            {cart.map((item) => (
              <div
                key={item._id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-50 to-green-100 text-3xl sm:h-20 sm:w-20 sm:text-4xl">
                    {cropIcon(item.cropName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold text-slate-900">
                          {item.cropName}
                        </h3>
                        <p className="truncate text-sm text-slate-500">
                          👨‍🌾 {item.farmerName} · 📍 {item.location}
                        </p>
                      </div>

                      <button
                        onClick={() => removeFromCart(item._id)}
                        aria-label={`Remove ${item.cropName}`}
                        className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                      >
                        🗑️
                      </button>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQuantity(item._id, item.cartQuantity - 1)}
                          aria-label="Decrease quantity"
                          className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold text-slate-700 transition hover:bg-slate-200"
                        >
                          −
                        </button>

                        <input
                          type="number"
                          min="1"
                          max={item.stock}
                          value={item.cartQuantity}
                          onChange={(e) =>
                            setQuantity(item._id, Number(e.target.value))
                          }
                          aria-label={`Quantity of ${item.cropName} in kg`}
                          className="h-9 w-16 rounded-lg border border-slate-200 text-center text-sm font-semibold outline-none focus:border-emerald-500"
                        />

                        <button
                          onClick={() => setQuantity(item._id, item.cartQuantity + 1)}
                          disabled={item.cartQuantity >= item.stock}
                          aria-label="Increase quantity"
                          className="h-9 w-9 rounded-lg bg-slate-100 text-lg font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-40"
                        >
                          +
                        </button>

                        <span className="ml-1 text-xs text-slate-400">
                          kg (max {item.stock})
                        </span>
                      </div>

                      <div className="text-right">
                        <p className="text-xs text-slate-400">
                          {currency(item.pricePerKg)}/kg
                        </p>
                        <p className="text-lg font-bold text-slate-900">
                          {currency(item.pricePerKg * item.cartQuantity)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={clearCart}
              className="text-sm font-semibold text-slate-500 transition hover:text-red-600"
            >
              Clear cart
            </button>
          </section>

          {/* Summary */}
          <aside>
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">Order summary</h3>

              <div className="mt-5 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Products</span>
                  <span className="font-medium">{cart.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total quantity</span>
                  <span className="font-medium">{itemCount} kg</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Delivery</span>
                  <span className="font-semibold text-emerald-600">Free</span>
                </div>
              </div>

              <label className="mt-5 block">
                <span className="text-sm font-medium text-slate-700">
                  Delivery address
                </span>
                <textarea
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Where should we deliver?"
                  className={`${inputClass} resize-none`}
                />
              </label>

              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-5">
                <span className="font-semibold text-slate-700">Total</span>
                <span className="text-2xl font-bold text-emerald-600">
                  {currency(totalPrice)}
                </span>
              </div>

              <Button
                onClick={handleCheckout}
                disabled={placing}
                className="mt-5 w-full py-3.5"
              >
                {placing ? "Placing order…" : "Place order →"}
              </Button>

              <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-700">
                🌱 Buying here supports farmers directly by cutting out
                unnecessary middlemen.
              </p>
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
