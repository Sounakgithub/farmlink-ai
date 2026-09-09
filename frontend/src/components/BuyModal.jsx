import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Button } from "./ui";
import { useCart } from "../context/CartContext";
import { useToast } from "../context/ToastContext";
import { currency, cropIcon } from "../lib/format";
import StartChatButton from "./StartChatButton";

/**
 * Lets a buyer choose how many kilograms they want before the crop goes into
 * the cart. Also the jumping-off point for messaging the farmer.
 */
export default function BuyModal({ product, open, onClose }) {
  const navigate = useNavigate();
  const { addToCart, isInCart } = useCart();
  const toast = useToast();

  const [qty, setQty] = useState(1);

  if (!product) return null;

  const stock = product.quantity ?? 0;
  const clamp = (n) => Math.max(1, Math.min(stock || 1, Math.round(n) || 1));
  const subtotal = qty * product.pricePerKg;

  const addAndClose = (thenGoToCart) => {
    if (stock <= 0) {
      toast.error(`${product.cropName} is sold out.`);
      return;
    }
    addToCart(product, qty);
    toast.success(
      `${qty} kg of ${product.cropName} ${
        isInCart(product._id) ? "updated in" : "added to"
      } your cart.`
    );
    onClose();
    if (thenGoToCart) navigate("/cart");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${cropIcon(product.cropName)} ${product.cropName}`}
      description={`From ${product.farmerName} · ${product.location}`}
      maxWidth="max-w-md"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
          <span className="text-sm text-slate-500">Price</span>
          <span className="text-lg font-bold text-emerald-600">
            {currency(product.pricePerKg)}
            <span className="text-xs font-normal text-slate-500"> / kg</span>
          </span>
        </div>

        {/* Quantity picker */}
        <div>
          <label className="text-sm font-medium text-slate-700">
            How many kilograms?
          </label>

          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQty((q) => clamp(q - 1))}
              className="h-11 w-11 rounded-xl bg-slate-100 text-xl font-bold text-slate-700 transition hover:bg-slate-200"
              aria-label="Decrease"
            >
              −
            </button>

            <input
              type="number"
              min="1"
              max={stock || undefined}
              value={qty}
              onChange={(e) => setQty(clamp(Number(e.target.value)))}
              className="h-11 w-24 rounded-xl border border-slate-200 text-center text-lg font-bold outline-none focus:border-emerald-500"
            />

            <button
              type="button"
              onClick={() => setQty((q) => clamp(q + 1))}
              disabled={qty >= stock}
              className="h-11 w-11 rounded-xl bg-slate-100 text-xl font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-40"
              aria-label="Increase"
            >
              +
            </button>

            <span className="text-sm text-slate-400">
              of {stock} {product.unit} available
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[5, 10, 25, 50].map((preset) =>
              preset <= stock ? (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQty(preset)}
                  className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-700"
                >
                  {preset} kg
                </button>
              ) : null
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <span className="font-semibold text-slate-700">Subtotal</span>
          <span className="text-2xl font-bold text-emerald-600">
            {currency(subtotal)}
          </span>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="flex-1 py-3"
            onClick={() => addAndClose(false)}
          >
            🛒 Add to cart
          </Button>
          <Button className="flex-1 py-3" onClick={() => addAndClose(true)}>
            Buy now →
          </Button>
        </div>

        <StartChatButton
          kind="buyer-farmer"
          productId={product._id}
          label="💬 Ask the farmer about freshness or price"
          variant="outline"
          className="w-full"
        />
      </div>
    </Modal>
  );
}
