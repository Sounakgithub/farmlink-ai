import { useState } from "react";
import { Button, Field, inputClass } from "./ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { KNOWN_CROPS, DEMAND_LOCATIONS } from "../lib/constants";

/**
 * Buyer matching preferences, shown inside the existing Profile page.
 *
 * Everything here is optional. Left blank, the matching engine falls back to
 * order history and then to a neutral score - so a buyer who ignores this
 * form is never penalised, just less precisely matched.
 */

const FREQUENCIES = [
  { value: "", label: "Not sure yet" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "occasional", label: "Now and then" },
];

const numberOrNull = (value) => (value === "" || value === null ? null : Number(value));

export default function BuyerPreferencesForm() {
  // Preferences ride on the existing profile endpoint, so the same
  // updateProfile() that saves a name also keeps the session in step here.
  const { user, updateProfile } = useAuth();
  const toast = useToast();

  const existing = user?.buyerPreferences || {};

  const [form, setForm] = useState({
    preferredCrops: existing.preferredCrops || [],
    preferredLocations: existing.preferredLocations || [],
    minPricePerKg: existing.minPricePerKg ?? "",
    maxPricePerKg: existing.maxPricePerKg ?? "",
    minQuantityKg: existing.minQuantityKg ?? "",
    preferredQuantityKg: existing.preferredQuantityKg ?? "",
    maxQuantityKg: existing.maxQuantityKg ?? "",
    purchaseFrequency: existing.purchaseFrequency || "",
  });
  const [saving, setSaving] = useState(false);

  const toggle = (field, value) =>
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((v) => v !== value)
        : [...prev[field], value],
    }));

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        buyerPreferences: {
          preferredCrops: form.preferredCrops,
          preferredLocations: form.preferredLocations,
          minPricePerKg: numberOrNull(form.minPricePerKg),
          maxPricePerKg: numberOrNull(form.maxPricePerKg),
          minQuantityKg: numberOrNull(form.minQuantityKg),
          preferredQuantityKg: numberOrNull(form.preferredQuantityKg),
          maxQuantityKg: numberOrNull(form.maxQuantityKg),
          purchaseFrequency: form.purchaseFrequency,
        },
      });

      toast.success("Preferences saved — your recommendations will use them.");
    } catch (error) {
      toast.error(error.message || "Could not save your preferences.");
    } finally {
      setSaving(false);
    }
  };

  const chip = (active) =>
    `rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      active
        ? "border-brand-500 bg-brand-50 text-brand-700"
        : "border-line bg-white text-ink-soft hover:border-emerald-300"
    }`;

  return (
    <form onSubmit={save} className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-ink">Crops you usually buy</h3>
        <p className="mt-1 text-xs text-ink-soft">
          Pick any number. Leave empty and we will learn from your orders instead.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {KNOWN_CROPS.map((crop) => (
            <button
              key={crop}
              type="button"
              onClick={() => toggle("preferredCrops", crop)}
              className={chip(form.preferredCrops.includes(crop))}
            >
              {crop}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-ink">Where you prefer to buy from</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMAND_LOCATIONS.map((city) => (
            <button
              key={city}
              type="button"
              onClick={() => toggle("preferredLocations", city)}
              className={chip(form.preferredLocations.includes(city))}
            >
              {city}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lowest price you'd consider (₹/kg)" hint="Optional">
          <input
            type="number"
            min="0"
            step="0.5"
            value={form.minPricePerKg}
            onChange={(e) => set("minPricePerKg", e.target.value)}
            placeholder="e.g. 10"
            className={inputClass}
          />
        </Field>

        <Field label="Most you'd pay (₹/kg)" hint="Optional">
          <input
            type="number"
            min="0"
            step="0.5"
            value={form.maxPricePerKg}
            onChange={(e) => set("maxPricePerKg", e.target.value)}
            placeholder="e.g. 40"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Smallest lot (kg)" hint="Optional">
          <input
            type="number"
            min="0"
            value={form.minQuantityKg}
            onChange={(e) => set("minQuantityKg", e.target.value)}
            placeholder="e.g. 50"
            className={inputClass}
          />
        </Field>

        <Field label="Usual order (kg)" hint="Used most">
          <input
            type="number"
            min="0"
            value={form.preferredQuantityKg}
            onChange={(e) => set("preferredQuantityKg", e.target.value)}
            placeholder="e.g. 300"
            className={inputClass}
          />
        </Field>

        <Field label="Largest lot (kg)" hint="Optional">
          <input
            type="number"
            min="0"
            value={form.maxQuantityKg}
            onChange={(e) => set("maxQuantityKg", e.target.value)}
            placeholder="e.g. 1000"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="How often do you restock?">
        <select
          value={form.purchaseFrequency}
          onChange={(e) => set("purchaseFrequency", e.target.value)}
          className={inputClass}
        >
          {FREQUENCIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>

      <Button type="submit" className="w-full py-3 sm:w-auto" disabled={saving}>
        {saving ? "Saving…" : "Save preferences"}
      </Button>
    </form>
  );
}
