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
  const [tiers, setTiers] = useState(
    (initial?.bulkTiers || []).map((t) => ({
      minQuantityKg: String(t.minQuantityKg),
      pricePerKg: String(t.pricePerKg),
    }))
  );
  const [chilled, setChilled] = useState(!!initial?.needsRefrigeration);

  const setTier = (index, key, value) =>
    setTiers(tiers.map((t, i) => (i === index ? { ...t, [key]: value } : t)));
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
        bulkTiers: tiers
          .filter((t) => t.minQuantityKg !== "" && t.pricePerKg !== "")
          .map((t) => ({ minQuantityKg: Number(t.minQuantityKg), pricePerKg: Number(t.pricePerKg) })),
        needsRefrigeration: chilled,
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

      {/* Wholesale: volume pricing and cold chain */}
      <div className="rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Bulk prices <span className="font-normal text-ink-faint">(optional)</span></p>
            <p className="mt-1 text-xs text-ink-soft">
              Offer a lower price per kg on bigger orders. Each tier must be cheaper than the one before.
            </p>
          </div>
          {tiers.length < 5 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTiers([...tiers, { minQuantityKg: "", pricePerKg: "" }])}
            >
              + Add tier
            </Button>
          )}
        </div>

        {tiers.length > 0 && (
          <div className="mt-3 space-y-2">
            {tiers.map((tier, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-ink-soft">From</span>
                <input
                  type="number"
                  min="2"
                  value={tier.minQuantityKg}
                  onChange={(e) => setTier(index, "minQuantityKg", e.target.value)}
                  aria-label="Minimum kg for this price"
                  className="w-24 rounded-lg border border-line-strong px-2 py-1.5 outline-none focus:border-brand-500"
                />
                <span className="text-ink-soft">kg at ₹</span>
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={tier.pricePerKg}
                  onChange={(e) => setTier(index, "pricePerKg", e.target.value)}
                  aria-label="Price per kg for this tier"
                  className="w-24 rounded-lg border border-line-strong px-2 py-1.5 outline-none focus:border-brand-500"
                />
                <span className="text-ink-soft">/kg</span>
                <button
                  type="button"
                  onClick={() => setTiers(tiers.filter((_, i) => i !== index))}
                  aria-label="Remove tier"
                  className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <label className="mt-4 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={chilled}
            onChange={(e) => setChilled(e.target.checked)}
            className="h-4 w-4 accent-brand-600"
          />
          Needs refrigerated transport
          <span className="text-xs text-ink-faint">(only chilled carriers will be offered it)</span>
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
