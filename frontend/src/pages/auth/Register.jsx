import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { HOME_FOR_ROLE } from "../../lib/constants";
import { useToast } from "../../context/ToastContext";
import { Button, ErrorNote, inputClass } from "../../components/ui";
import BrandMark from "../../components/BrandMark";

const ROLES = [
  {
    value: "farmer",
    icon: "🌾",
    title: "Farmer",
    blurb: "List crops, price them with AI, manage orders",
  },
  {
    value: "buyer",
    icon: "🧺",
    title: "Buyer",
    blurb: "Buy direct from farms and track every delivery",
  },
  {
    value: "driver",
    icon: "🚚",
    title: "Delivery",
    blurb: "Run optimised multi-stop delivery routes",
  },
  {
    value: "logistics",
    icon: "🏢",
    title: "Logistics company",
    blurb: "Take delivery jobs for your fleet at your own rates",
  },
];

export default function Register() {
  const navigate = useNavigate();
  const { register, user, loading } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "farmer",
    location: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!loading && user) {
    return <Navigate to={HOME_FOR_ROLE[user.role] || "/login"} replace />;
  }

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setSubmitting(true);

    try {
      const created = await register(form);
      toast.success(`Welcome to FarmLink, ${created.name}!`);
      navigate(HOME_FOR_ROLE[created.role] || "/login", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 py-12 sm:px-6">
      {/* A hint of field colour behind the card. */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[30rem] w-[44rem] -translate-x-1/2 rounded-full bg-brand-200/35 blur-[120px]" />

      <div className="animate-fade-up relative w-full max-w-xl">
        <div className="mb-7 text-center">
          <Link to="/" className="inline-block">
            <BrandMark size={52} className="mx-auto" />
          </Link>
          <h1 className="fl-display mt-5 text-3xl text-ink sm:text-4xl">
            Create your account
          </h1>
          <p className="mt-3 text-sm text-ink-soft">
            One minute, and you are trading directly.
          </p>
        </div>

        <div className="fl-card p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && <ErrorNote message={error} />}

            {/* Role picker */}
            <div>
              <span className="text-sm font-semibold text-ink">I am a…</span>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {ROLES.map((role) => {
                  const active = form.role === role.value;
                  return (
                    <button
                      type="button"
                      key={role.value}
                      onClick={() => setForm({ ...form, role: role.value })}
                      aria-pressed={active}
                      className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-250 ${
                        active
                          ? "border-brand-500 bg-brand-50/70 shadow-[0_0_0_3px_rgba(34,197,94,.14)]"
                          : "border-line bg-surface hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[var(--shadow-card)]"
                      }`}
                    >
                      {active && (
                        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                          ✓
                        </span>
                      )}
                      <span className="text-2xl transition-transform duration-250 group-hover:scale-110">
                        {role.icon}
                      </span>
                      <p className="mt-2.5 text-sm font-bold text-ink">
                        {role.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                        {role.blurb}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-ink">Full name</span>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. Ravi Kumar"
                required
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-ink">Email</span>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className={inputClass}
              />
            </label>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-ink">Password</span>
                <input
                  type="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-ink">
                  City <span className="font-normal text-ink-faint">(optional)</span>
                </span>
                <input
                  type="text"
                  name="location"
                  value={form.location}
                  onChange={handleChange}
                  placeholder="e.g. Delhi"
                  className={inputClass}
                />
              </label>
            </div>

            <Button type="submit" size="lg" className="w-full" loading={submitting}>
              {submitting ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-soft">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-bold text-brand-700 transition hover:text-brand-800"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
