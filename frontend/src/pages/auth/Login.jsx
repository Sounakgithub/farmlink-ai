import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { HOME_FOR_ROLE } from "../../lib/constants";
import { useToast } from "../../context/ToastContext";
import { Button, ErrorNote, inputClass } from "../../components/ui";
import BrandMark, { BrandLockup } from "../../components/BrandMark";

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
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* ---- brand panel ------------------------------------------------- */}
      <div className="fl-soil relative hidden overflow-hidden p-12 lg:flex lg:w-[46%] lg:flex-col lg:justify-between">
        <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-60" />
        <div className="animate-drift pointer-events-none absolute -left-32 top-1/4 h-[28rem] w-[28rem] rounded-full bg-brand-500/18 blur-[110px]" />

        <div className="relative">
          <Link to="/" className="inline-block">
            <BrandLockup size={34} tone="light" />
          </Link>
        </div>

        <div className="relative animate-fade-up">
          <h1 className="fl-display text-4xl text-white xl:text-5xl">
            Welcome back to
            <br />
            <span className="fl-gradient-text">the field.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-white/55">
            Your crops, orders and deliveries — priced, matched and routed by
            models that show their working.
          </p>

          <div className="mt-10 space-y-3">
            {[
              ["◈", "AI price advisor, explained rupee by rupee"],
              ["◎", "Buyer and produce matching with scores"],
              ["➔", "Optimised farm-to-door delivery routing"],
            ].map(([icon, text], i) => (
              <div
                key={text}
                className="fl-glass-dark animate-fade-up flex items-center gap-3 rounded-xl px-4 py-3"
                style={{ animationDelay: `${150 + i * 90}ms` }}
              >
                <span className="text-brand-400">{icon}</span>
                <span className="text-sm text-white/70">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/30">
          Direct farmer-to-buyer commerce.
        </p>
      </div>

      {/* ---- form -------------------------------------------------------- */}
      <div className="flex flex-1 items-center justify-center bg-canvas px-4 py-10 sm:px-6">
        <div className="animate-fade-up w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <Link to="/" className="inline-block">
              <BrandMark size={48} className="mx-auto" />
            </Link>
          </div>

          <div className="fl-card p-6 sm:p-8">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Sign in
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              Continue to your FarmLink workspace.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {error && <ErrorNote message={error} />}

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

              <label className="block">
                <span className="text-sm font-semibold text-ink">Password</span>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-bold text-brand-700 transition hover:bg-brand-50"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                loading={submitting}
              >
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-sm text-ink-soft">
            New to FarmLink?{" "}
            <Link
              to="/register"
              className="font-bold text-brand-700 transition hover:text-brand-800"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
