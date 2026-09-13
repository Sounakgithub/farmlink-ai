import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { Button, ConfirmDialog, inputClass } from "../../components/ui";
import BuyerPreferencesForm from "../../components/BuyerPreferencesForm";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { formatDate } from "../../lib/format";

const ROLE_INFO = {
  farmer: { icon: "👨‍🌾", label: "Farmer", blurb: "You can list crops and manage incoming orders." },
  buyer: { icon: "🧑‍🍳", label: "Buyer", blurb: "You can shop the marketplace and track deliveries." },
  driver: { icon: "🚚", label: "Delivery partner", blurb: "You run optimised multi-stop delivery routes." },
};

export default function Profile() {
  const { user, updateProfile, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    location: user?.location || "",
  });
  const [saving, setSaving] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const role = ROLE_INFO[user?.role] || ROLE_INFO.buyer;

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <AppShell title="Profile" subtitle="Your account details">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity card */}
        <section className="fl-card p-6 text-center shadow-sm">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-brand-100 text-4xl">
            {role.icon}
          </div>

          <h2 className="mt-4 text-xl font-bold text-ink">{user?.name}</h2>
          <p className="mt-1 break-all text-sm text-ink-soft">{user?.email}</p>

          <span className="mt-4 inline-flex rounded-full bg-brand-100 px-4 py-1.5 text-xs font-semibold text-brand-700">
            {role.label}
          </span>

          <p className="mt-4 text-xs leading-5 text-ink-soft">{role.blurb}</p>

          {user?.createdAt && (
            <p className="mt-4 border-t border-line pt-4 text-xs text-ink-faint">
              Member since {formatDate(user.createdAt)}
            </p>
          )}

          <Button
            variant="danger"
            className="mt-5 w-full py-3"
            onClick={() => setConfirmLogout(true)}
          >
            🚪 Log out
          </Button>
        </section>

        {/* Editable details */}
        <section className="fl-card p-5 sm:p-6 lg:col-span-2">
          <h2 className="text-lg font-bold text-ink sm:text-xl">
            Account details
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Keep your contact details up to date so orders reach you.
          </p>

          <form onSubmit={handleSave} className="mt-6 space-y-5">
            <label className="block">
              <span className="text-sm font-medium text-ink">Full name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className={inputClass}
              />
            </label>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-ink">Phone</span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g. 98765 43210"
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">City</span>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Delhi"
                  className={inputClass}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-ink">Email</span>
              <input
                type="email"
                value={user?.email || ""}
                disabled
                className={`${inputClass} cursor-not-allowed bg-canvas text-ink-faint`}
              />
              <span className="mt-1 block text-xs text-ink-faint">
                Your email address can't be changed.
              </span>
            </label>

            <Button type="submit" className="w-full py-3 sm:w-auto" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </section>

        {/* Buyer-only: what the AI matching layer should optimise for. */}
        {user?.role === "buyer" && (
          <section className="fl-card p-5 sm:p-6 lg:col-span-3">
            <h2 className="text-lg font-bold text-ink sm:text-xl">
              🤖 Matching preferences
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              Optional. These sharpen your AI crop recommendations — leave anything
              blank and we'll learn from your order history instead.
            </p>

            <div className="mt-6">
              <BuyerPreferencesForm />
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        message="You'll need to sign in again to access your dashboard."
        confirmLabel="Log out"
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
      />
    </AppShell>
  );
}
