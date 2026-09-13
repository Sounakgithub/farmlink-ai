import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { Button, EmptyState, inputClass } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useToast } from "../../context/ToastContext";
import { currency, cropIcon } from "../../lib/format";
import { PAYMENT_METHODS } from "../../lib/constants";

export default function Cart() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { cart, totalPrice, itemCount, setQuantity, removeFromCart, clearCart } =
    useCart();

  const [address, setAddress] = useState(user?.location || "");
  const [instructions, setInstructions] = useState("");
  const [payment, setPayment] = useState("Cash on Delivery");
  const [placing, setPlacing] = useState(false);

  const chosen = PAYMENT_METHODS.find((m) => m.value === payment);
  const prepaid = !!chosen?.prepaid;

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!address.trim()) {
      toast.error("Add a delivery address first.");
      return;
    }

    setPlacing(true);
    try {
      await api.post("/orders", {
        items: cart.map((item) => ({
          productId: item._id,
          quantity: item.cartQuantity,
        })),
        deliveryAddress: address.trim(),
        deliveryInstructions: instructions.trim(),
        paymentMethod: payment,
      });

      clearCart();
      toast.success(
        prepaid
          ? "Payment received — the farmer will confirm your order shortly."
          : "Order placed! Pay cash when it arrives."
      );
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
      subtitle={`${itemCount} kg across ${cart.length} product${
        cart.length === 1 ? "" : "s"
      }`}
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
                className="fl-card p-4 shadow-sm sm:p-5"
              >
                <div className="flex gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-3xl sm:h-20 sm:w-20 sm:text-4xl">
                    {cropIcon(item.cropName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold text-ink">
                          {item.cropName}
                        </h3>
                        <p className="truncate text-sm text-ink-soft">
                          👨‍🌾 {item.farmerName} · 📍 {item.location}
                        </p>
                      </div>

                      <button
                        onClick={() => removeFromCart(item._id)}
                        aria-label={`Remove ${item.cropName}`}
                        className="shrink-0 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
                      >
                        🗑️
                      </button>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setQuantity(item._id, item.cartQuantity - 1)}
                          aria-label="Decrease quantity"
                          className="h-9 w-9 rounded-lg bg-canvas text-lg font-bold text-ink transition hover:bg-line"
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
                          className="h-9 w-16 rounded-lg border border-line text-center text-sm font-semibold outline-none focus:border-brand-500"
                        />

                        <button
                          onClick={() => setQuantity(item._id, item.cartQuantity + 1)}
                          disabled={item.cartQuantity >= item.stock}
                          aria-label="Increase quantity"
                          className="h-9 w-9 rounded-lg bg-canvas text-lg font-bold text-ink transition hover:bg-line disabled:opacity-40"
                        >
                          +
                        </button>

                        <span className="ml-1 text-xs text-ink-faint">
                          kg (max {item.stock})
                        </span>
                      </div>

                      <div className="text-right">
                        <p className="text-xs text-ink-faint">
                          {currency(item.pricePerKg)}/kg
                        </p>
                        <p className="text-lg font-bold text-ink">
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
              className="text-sm font-semibold text-ink-soft transition hover:text-rose-600"
            >
              Clear cart
            </button>
          </section>

          {/* Summary + checkout */}
          <aside>
            <div className="sticky top-24 space-y-4">
              <div className="fl-card p-5 sm:p-6">
                <h3 className="text-lg font-bold text-ink">Order summary</h3>

                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Products</span>
                    <span className="font-medium">{cart.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Total quantity</span>
                    <span className="font-medium">{itemCount} kg</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-soft">Delivery</span>
                    <span className="font-semibold text-brand-700">Free</span>
                  </div>
                </div>

                <label className="mt-5 block">
                  <span className="text-sm font-medium text-ink">
                    Delivery address
                  </span>
                  <textarea
                    rows={2}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Flat / house, street, area, city"
                    className={`${inputClass} resize-none`}
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-sm font-medium text-ink">
                    Delivery instructions{" "}
                    <span className="text-ink-faint">(optional)</span>
                  </span>
                  <textarea
                    rows={2}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="e.g. call on arrival, gate code, landmark"
                    className={`${inputClass} resize-none`}
                  />
                  <span className="mt-1 block text-xs text-ink-faint">
                    You can also chat with your delivery partner once one is
                    assigned.
                  </span>
                </label>
              </div>

              {/* Payment method */}
              <div className="fl-card p-5 sm:p-6">
                <h3 className="text-lg font-bold text-ink">Payment method</h3>

                <div className="mt-4 space-y-2">
                  {PAYMENT_METHODS.map((method) => {
                    const active = payment === method.value;
                    return (
                      <button
                        key={method.value}
                        type="button"
                        onClick={() => setPayment(method.value)}
                        aria-pressed={active}
                        className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition ${
                          active
                            ? "border-brand-500 bg-brand-50"
                            : "border-line hover:border-line-strong"
                        }`}
                      >
                        <span className="text-xl">{method.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-ink">
                            {method.label}
                          </span>
                          <span className="block truncate text-xs text-ink-soft">
                            {method.hint}
                          </span>
                        </span>
                        <span
                          className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                            active
                              ? "border-brand-500 bg-brand-500"
                              : "border-line-strong"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>

                {prepaid && (
                  <p className="mt-3 rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-700 ring-1 ring-sky-100">
                    This is a demo checkout — no real payment is taken. Your order
                    is marked paid immediately.
                  </p>
                )}
              </div>

              {/* Total + place */}
              <div className="fl-card p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink">Total</span>
                  <span className="text-2xl font-bold text-brand-700">
                    {currency(totalPrice)}
                  </span>
                </div>

                <Button
                  onClick={handleCheckout}
                  disabled={placing}
                  className="mt-4 w-full py-3.5"
                >
                  {placing
                    ? "Placing order…"
                    : prepaid
                    ? `Pay ${currency(totalPrice)} & place order`
                    : "Place order →"}
                </Button>

                <p className="mt-3 text-center text-xs text-ink-faint">
                  {chosen?.icon} Paying by {chosen?.label}
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
