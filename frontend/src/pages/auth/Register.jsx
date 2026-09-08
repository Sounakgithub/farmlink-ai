import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { HOME_FOR_ROLE } from "../../lib/constants";
import { useToast } from "../../context/ToastContext";
import { Button, ErrorNote, inputClass } from "../../components/ui";

const ROLES = [
  {
    value: "farmer",
    icon: "👨‍🌾",
    title: "Farmer",
    blurb: "List crops, get AI pricing, manage orders",
  },
  {
    value: "buyer",
    icon: "🧑‍🍳",
    title: "Buyer",
    blurb: "Buy direct from farms and track deliveries",
  },
  {
    value: "driver",
    icon: "🚚",
    title: "Delivery",
    blurb: "Run optimised multi-stop delivery routes",
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 sm:px-6">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-center">
          <span className="text-5xl">🌾</span>
          <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Join FarmLink and start trading directly.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          {error && <ErrorNote message={error} />}

          {/* Role picker */}
          <div>
            <span className="text-sm font-medium text-slate-700">I am a…</span>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {ROLES.map((role) => {
                const active = form.role === role.value;
                return (
                  <button
                    type="button"
                    key={role.value}
                    onClick={() => setForm({ ...form, role: role.value })}
                    aria-pressed={active}
                    className={`rounded-2xl border-2 p-4 text-left transition ${
                      active
                        ? "border-emerald-500 bg-emerald-50 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className="text-2xl">{role.icon}</span>
                    <p className="mt-2 text-sm font-bold text-slate-900">
                      {role.title}
                    </p>
                    <p className="mt-1 text-xs leading-4 text-slate-500">
                      {role.blurb}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Full name</span>
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
            <span className="text-sm font-medium text-slate-700">Email</span>
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
              <span className="text-sm font-medium text-slate-700">Password</span>
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
              <span className="text-sm font-medium text-slate-700">
                City <span className="text-slate-400">(optional)</span>
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

          <Button type="submit" className="w-full py-3" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-semibold text-emerald-600 hover:text-emerald-700"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
