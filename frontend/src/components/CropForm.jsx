import { useState } from "react";
import { ml } from "../lib/api";
import PriceExplanation from "./PriceExplanation";
import FairDealPanel from "./FairDealPanel";
import { useToast } from "../context/ToastContext";
import { Button, inputClass } from "./ui";

const EMPTY = {
  cropName: "",
  quantity: "",
  unit: "kg",
  location: "",
  pricePerKg: "",
  image: "",
};

/**
 * Add / edit form for a crop listing.
 * The farmer identity is never part of this form - the server takes it from
 * the auth token, which is what stopped listings saving before.
 */
export default function CropForm({ initial, onSubmit, onCancel, submitLabel = "Save crop" }) {
  const toast = useToast();

  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [submitting, setSubmitting] = useState(false);
  const [aiPrice, setAiPrice] = useState(null);
  const [aiExplanation, setAiExplanation] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const suggestPrice = async () => {
    if (!form.cropName || !form.location || !form.quantity || !form.pricePerKg) {
      toast.error("Fill in crop, location, quantity and your price first.");
      return;
    }

    setAiLoading(true);
    setAiPrice(null);
    setAiExplanation(null);

    try {
      const data = await ml.predictPrice({
        crop: form.cropName,
        location: form.location,
        quantity: Number(form.quantity),
        demand: 8,
        market_price: Number(form.pricePerKg),
      });
      setAiPrice(data.recommended_price);
      // may be null if the ML service could not build a SHAP explanation
      setAiExplanation(data.explanation ?? null);
    } catch (error) {
      toast.error(
        error.status === 0
          ? "ML service unreachable — start it with `python app.py` in ml-service."
          : error.message
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await onSubmit({
        cropName: form.cropName.trim(),
        quantity: Number(form.quantity),
        unit: form.unit,
        location: form.location.trim(),
        pricePerKg: Number(form.pricePerKg),
        image: form.image.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink">Crop name</span>
          <input
            type="text"
            name="cropName"
            value={form.cropName}
            onChange={handleChange}
            placeholder="e.g. Tomato"
            required
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Location</span>
          <input
            type="text"
            name="location"
            value={form.location}
            onChange={handleChange}
            placeholder="e.g. Gurgaon"
            required
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Quantity</span>
          <input
            type="number"
            name="quantity"
            value={form.quantity}
            onChange={handleChange}
            placeholder="e.g. 500"
            min="1"
            required
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Unit</span>
          <select
            name="unit"
            value={form.unit}
            onChange={handleChange}
            className={inputClass}
          >
            <option value="kg">Kilogram (kg)</option>
            <option value="quintal">Quintal</option>
            <option value="ton">Ton</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">Price per kg (₹)</span>
          <input
            type="number"
            name="pricePerKg"
            value={form.pricePerKg}
            onChange={handleChange}
            placeholder="e.g. 26"
            min="1"
            step="0.5"
            required
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink">
            Image URL <span className="text-ink-faint">(optional)</span>
          </span>
          <input
            type="text"
            name="image"
            value={form.image}
            onChange={handleChange}
            placeholder="https://…"
            className={inputClass}
          />
        </label>
      </div>

      {/* AI price helper */}
      <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-800">
              🤖 Not sure what to charge?
            </p>
            <p className="mt-1 text-xs text-brand-700">
              Get an AI-recommended price for this crop and location.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={suggestPrice}
            disabled={aiLoading}
            className="shrink-0"
          >
            {aiLoading ? "Asking AI…" : "Suggest a price"}
          </Button>
        </div>

        {aiPrice !== null && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-3 rounded-xl bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink-soft">
                Recommended:{" "}
                <span className="text-lg font-bold text-brand-700">
                  ₹{aiPrice}/kg
                </span>
              </p>

              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm({ ...form, pricePerKg: String(aiPrice) })}
              >
                Use this price
              </Button>
            </div>

            {/* Renders nothing when the ML service returned explanation: null */}
            <PriceExplanation explanation={aiExplanation} />

            {/* What this price is worth against a farm-gate sale to a trader */}
            <FairDealPanel
              cropName={form.cropName}
              pricePerKg={form.pricePerKg}
              quantityKg={form.quantity}
              location={form.location}
              audience="farmer"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            className="flex-1 py-3"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
        )}

        <Button type="submit" className="flex-1 py-3" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
