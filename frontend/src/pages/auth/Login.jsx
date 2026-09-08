import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { HOME_FOR_ROLE } from "../../lib/constants";
import { useToast } from "../../context/ToastContext";
import { Button, ErrorNote, inputClass } from "../../components/ui";

export default function Login() {
  const navigate = useNavigate();
  const { login, user, loading } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Already signed in? Go straight to the right dashboard.
  if (!loading && user) {
    return <Navigate to={HOME_FOR_ROLE[user.role] || "/login"} replace />;
  }

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const loggedIn = await login(form.email, form.password);
      toast.success(`Welcome back, ${loggedIn.name}!`);
      navigate(HOME_FOR_ROLE[loggedIn.role] || "/login", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 lg:flex-row">
      {/* Brand panel */}
      <div className="hidden bg-gradient-to-br from-emerald-900 via-emerald-800 to-green-700 p-12 text-white lg:flex lg:w-1/2 lg:flex-col lg:justify-center">
        <span className="text-6xl">🌾</span>
        <h1 className="mt-6 text-4xl font-bold">FarmLink AI</h1>
        <p className="mt-4 max-w-md text-lg text-emerald-100">
          Fresh produce, straight from the farm — with AI pricing, demand
          forecasting and optimised delivery routes.
        </p>

        <div className="mt-10 space-y-4 text-sm text-emerald-100">
          <p>🤖 AI price advisor &amp; demand forecasting</p>
          <p>🧭 Optimised multi-stop delivery routing</p>
          <p>🚜 Direct farmer-to-buyer marketplace</p>
        </div>
      </div>

      {/* Form */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="text-center lg:hidden">
            <span className="text-5xl">🌾</span>
          </div>

          <h2 className="mt-4 text-center text-2xl font-bold text-slate-900 sm:text-3xl lg:mt-0">
            Welcome back
          </h2>
          <p className="mt-2 text-center text-sm text-slate-500">
            Log in to your FarmLink account.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {error && <ErrorNote message={error} />}

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

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Your password"
                  required
                  autoComplete="current-password"
                  className={`${inputClass} pr-16`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-emerald-600"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <Button type="submit" className="w-full py-3" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            New to FarmLink?{" "}
            <Link
              to="/register"
              className="font-semibold text-emerald-600 hover:text-emerald-700"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
