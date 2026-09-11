import { Link } from "react-router-dom";
import BrandMark, { BrandLockup } from "../components/BrandMark";
import { Button, Reveal } from "../components/ui";

/**
 * The front door.
 *
 * Previously "/" bounced straight to the login form, so a first-time visitor
 * never learned what FarmLink is. This is the page that answers that, and it
 * is built from the product's real capabilities — the price model, the demand
 * forecast, the matching engine, the routing — rather than invented claims.
 *
 * The floating chips are illustrative examples of what the product shows, and
 * are labelled as a preview, not presented as live readings.
 */

const PILLARS = [
  {
    icon: "◈",
    title: "Priced by model, explained in plain words",
    body: "A random-forest price model reads crop, location, quantity, demand and the going market rate — then SHAP explains exactly which of those moved the number, in rupees per kilo.",
    accent: "brand",
  },
  {
    icon: "◎",
    title: "Matched, not just listed",
    body: "Farmers see the buyers most likely to want this crop; buyers see the produce that fits how they actually buy. Every match shows its score, its reasoning and its limits.",
    accent: "brand",
  },
  {
    icon: "◱",
    title: "Demand you can plan around",
    body: "Gradient-boosted forecasting over three years of monthly demand — seasonality, festivals, weather and price elasticity — so planting decisions start from evidence.",
    accent: "harvest",
  },
  {
    icon: "➔",
    title: "Routed farm to doorstep",
    body: "Every order is a collection and a delivery. The planner keeps each pickup ahead of its own drop-off and still cuts the run short, then tracks it live on the map.",
    accent: "harvest",
  },
];

const ROLES = [
  {
    emoji: "🌾",
    role: "Farmers",
    line: "List a harvest, price it with evidence, and meet the buyers who want it.",
    points: ["AI price advisor", "Buyer match scores", "Demand forecasts"],
  },
  {
    emoji: "🧺",
    role: "Buyers",
    line: "Buy direct from the farm at a price that beats the shop, with the chain visible.",
    points: ["Recommended produce", "Fair-deal breakdown", "Live order tracking"],
  },
  {
    emoji: "🚚",
    role: "Delivery partners",
    line: "Take pickups nearby and run an optimised multi-stop route.",
    points: ["Optimised routing", "Live navigation view", "Buyer chat"],
  },
];

function FloatingChip({ className = "", delay = 0, children }) {
  return (
    <div
      className={`fl-glass-dark animate-float absolute hidden rounded-2xl px-4 py-3 text-white shadow-[var(--shadow-pop)] lg:block ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas">
      {/* ================= NAV ================= */}
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
        <nav className="fl-glass mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl px-4 py-3 shadow-[var(--shadow-card)] sm:px-5">
          <BrandLockup size={32} />

          <div className="hidden items-center gap-1 md:flex">
            {[
              ["Platform", "#platform"],
              ["Who it's for", "#roles"],
              ["How it works", "#how"],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-canvas hover:text-ink"
              >
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button as={Link} to="/login" variant="ghost" size="sm">
              Sign in
            </Button>
            <Button as={Link} to="/register" size="sm">
              Get started
            </Button>
          </div>
        </nav>
      </header>

      {/* ================= HERO ================= */}
      <section className="fl-soil relative overflow-hidden pb-24 pt-32 sm:pb-32 sm:pt-40">
        <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-60" />

        {/* Atmospheric light, drifting slowly. */}
        <div className="animate-drift pointer-events-none absolute -left-40 top-0 h-[34rem] w-[34rem] rounded-full bg-brand-500/18 blur-[120px]" />
        <div
          className="animate-drift pointer-events-none absolute -right-32 top-40 h-[28rem] w-[28rem] rounded-full bg-harvest-500/12 blur-[120px]"
          style={{ animationDelay: "3s" }}
        />

        <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
          <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            {/* ---- copy ---- */}
            <div className="animate-fade-up">
              <span className="fl-glass-dark inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold text-brand-200">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-400" />
                </span>
                Four models running in production
              </span>

              <h1 className="fl-display mt-6 text-[2.75rem] text-white sm:text-6xl lg:text-[4.25rem]">
                Smart farming.
                <br />
                Direct commerce.
                <br />
                <span className="fl-gradient-text">Intelligent delivery.</span>
              </h1>

              <p className="mt-7 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
                FarmLink AI connects farmers straight to buyers — no traders in
                between. Machine learning prices the harvest, forecasts demand,
                finds the right counterparty and routes the van. Every number it
                shows you, it explains.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button as={Link} to="/register" size="lg" className="group">
                  Shop fresh produce
                  <span className="transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </Button>
                <Button
                  as={Link}
                  to="/register"
                  size="lg"
                  variant="ghost"
                  className="text-white ring-1 ring-white/15 hover:bg-white/10 hover:text-white"
                >
                  Sell your harvest
                </Button>
              </div>

              <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/10 pt-8">
                {[
                  ["10", "crops modelled"],
                  ["8", "cities covered"],
                  ["R² 0.97", "demand accuracy"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="fl-numeric text-2xl font-bold text-white sm:text-3xl">
                      {value}
                    </dt>
                    <dd className="mt-1 text-xs text-white/45">{label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* ---- visual ---- */}
            <div className="relative animate-fade-up delay-2">
              <div className="fl-glass-dark relative rounded-3xl p-6 shadow-[var(--shadow-pop)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <BrandMark size={30} animated />
                    <span className="text-sm font-bold text-white">
                      Price advisor
                    </span>
                  </div>
                  <span className="rounded-full bg-brand-400/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-brand-300">
                    Preview
                  </span>
                </div>

                <div className="mt-6">
                  <p className="text-xs text-white/45">Recommended price</p>
                  <p className="fl-numeric mt-1 text-5xl font-bold text-white">
                    ₹33.83
                    <span className="ml-2 text-base font-medium text-white/40">
                      / kg
                    </span>
                  </p>
                </div>

                <div className="mt-7 space-y-3.5">
                  <p className="fl-eyebrow text-white/35">Why this price</p>

                  {[
                    ["Current market price", "+₹7.05", 100, "brand"],
                    ["Demand level", "+₹0.36", 34, "brand"],
                    ["Crop type", "−₹0.57", 42, "rose"],
                    ["Available quantity", "−₹0.11", 18, "rose"],
                  ].map(([label, delta, width, tone], i) => (
                    <div key={label}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-white/65">{label}</span>
                        <span
                          className={`fl-numeric font-bold ${
                            tone === "brand" ? "text-brand-300" : "text-rose-300"
                          }`}
                        >
                          {delta}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full origin-left rounded-full ${
                            tone === "brand" ? "bg-brand-400" : "bg-rose-400"
                          }`}
                          style={{
                            width: `${width}%`,
                            animation: "fl-fade-in .6s var(--ease-out-soft) both",
                            animationDelay: `${400 + i * 120}ms`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <p className="mt-6 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-white/35">
                  An illustration of the real output. In the app these figures
                  come from SHAP on the trained model for your own listing.
                </p>
              </div>

              <FloatingChip className="-left-12 top-16" delay={0}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-300">
                  Demand forecast
                </p>
                <p className="mt-1 text-sm font-bold">Onion · rising 12%</p>
              </FloatingChip>

              <FloatingChip className="-right-10 bottom-24" delay={1500}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-harvest-300">
                  Fresh harvest
                </p>
                <p className="mt-1 text-sm font-bold">24 min away</p>
              </FloatingChip>

              <FloatingChip className="-left-8 bottom-4" delay={2600}>
                <p className="text-sm font-bold">+18 farmers online</p>
              </FloatingChip>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PLATFORM ================= */}
      <section id="platform" className="mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-28">
        <Reveal className="max-w-2xl">
          <p className="fl-eyebrow text-brand-700">The platform</p>
          <h2 className="fl-display mt-3 text-3xl text-ink sm:text-[2.6rem]">
            Four models, one supply chain
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink-soft">
            Not a marketplace with a chatbot bolted on. Each model does a
            specific job in the chain, and each one shows its working.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {PILLARS.map((pillar, i) => (
            <Reveal key={pillar.title} delay={i * 80}>
              <article className="fl-card fl-card-interactive group h-full p-7">
                <span
                  className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl text-xl ring-1 transition-transform duration-300 group-hover:scale-105 ${
                    pillar.accent === "brand"
                      ? "bg-brand-50 text-brand-700 ring-brand-100"
                      : "bg-harvest-50 text-harvest-700 ring-harvest-100"
                  }`}
                >
                  {pillar.icon}
                </span>
                <h3 className="mt-5 text-lg font-bold tracking-tight text-ink">
                  {pillar.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">
                  {pillar.body}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= ROLES ================= */}
      <section id="roles" className="fl-soil relative overflow-hidden py-24 sm:py-28">
        <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-50" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-brand-500/10 blur-[110px]" />

        <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
          <Reveal className="max-w-2xl">
            <p className="fl-eyebrow text-brand-400">Who it's for</p>
            <h2 className="fl-display mt-3 text-3xl text-white sm:text-[2.6rem]">
              Three sides of the same trade
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/55">
              One account each, one workspace each. Nobody wades through tools
              that belong to somebody else's job.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {ROLES.map((role, i) => (
              <Reveal key={role.role} delay={i * 90}>
                <article className="fl-glass-dark group h-full rounded-2xl p-7 transition-transform duration-300 hover:-translate-y-1">
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-2xl ring-1 ring-white/10">
                    {role.emoji}
                  </span>
                  <h3 className="mt-5 text-xl font-bold tracking-tight text-white">
                    {role.role}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-white/55">
                    {role.line}
                  </p>
                  <ul className="mt-6 space-y-2.5 border-t border-white/10 pt-5">
                    {role.points.map((point) => (
                      <li
                        key={point}
                        className="flex items-center gap-2.5 text-sm text-white/70"
                      >
                        <span className="text-brand-400">✓</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= HOW ================= */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-24 sm:px-6 sm:py-28">
        <Reveal className="max-w-2xl">
          <p className="fl-eyebrow text-brand-700">How it works</p>
          <h2 className="fl-display mt-3 text-3xl text-ink sm:text-[2.6rem]">
            Harvest to doorstep, tracked end to end
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["01", "List with confidence", "The farmer lists a crop and the price model recommends a rate, explaining every rupee of it."],
            ["02", "Match and order", "Buyers see produce ranked for how they actually buy. They order direct from the farm."],
            ["03", "Accept and dispatch", "The farmer accepts; a nearby delivery partner is assigned and the route is planned."],
            ["04", "Track to the door", "Pickup, transit and delivery on a live map, with the driver reachable throughout."],
          ].map(([num, title, body], i) => (
            <Reveal key={num} delay={i * 80} className="relative">
              {/* Connector, drawn only between cards on wide screens. */}
              {i < 3 && (
                <span className="absolute right-0 top-5 hidden h-px w-6 translate-x-3 bg-line-strong lg:block" />
              )}
              <span className="fl-numeric text-4xl font-bold text-brand-200">
                {num}
              </span>
              <h3 className="mt-3 text-base font-bold text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="px-5 pb-24 sm:px-6">
        <Reveal className="mx-auto max-w-5xl">
          <div className="fl-soil relative overflow-hidden rounded-3xl px-8 py-16 text-center sm:px-14 sm:py-20">
            <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-50" />
            <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[32rem] -translate-x-1/2 rounded-full bg-brand-500/18 blur-[100px]" />

            <div className="relative">
              <BrandMark size={52} animated className="mx-auto" />
              <h2 className="fl-display mt-7 text-3xl text-white sm:text-5xl">
                Start trading directly
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-white/55">
                Create a free account as a farmer, a buyer or a delivery
                partner. It takes about a minute.
              </p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <Button as={Link} to="/register" size="lg">
                  Create your account
                </Button>
                <Button
                  as={Link}
                  to="/login"
                  size="lg"
                  variant="ghost"
                  className="text-white ring-1 ring-white/15 hover:bg-white/10 hover:text-white"
                >
                  I already have one
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-6">
          <BrandLockup size={28} />
          <p className="text-xs text-ink-faint">
            Direct farmer-to-buyer commerce, with the reasoning shown.
          </p>
        </div>
      </footer>
    </div>
  );
}
