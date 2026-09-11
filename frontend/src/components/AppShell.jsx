import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useMessages } from "../context/MessagesContext";
import { ConfirmDialog } from "./ui";
import BrandMark from "./BrandMark";

/**
 * The application frame.
 *
 * A dark "soil" rail carries navigation and identity; the working area stays
 * light so produce, data and maps read cleanly against it. Navigation is
 * grouped by intent rather than listed flat, because a farmer scanning for
 * "AI Insights" should not have to read past "Marketplace" to find it.
 *
 * Every role sees a different rail — the groups below are the whole of it.
 */

const NAV_BY_ROLE = {
  farmer: [
    {
      group: "Selling",
      items: [
        { to: "/farmer", icon: "◱", label: "Dashboard", end: true },
        { to: "/farmer/products", icon: "❦", label: "My Crops" },
        { to: "/farmer/orders", icon: "✦", label: "Orders" },
      ],
    },
    {
      group: "Intelligence",
      items: [
        { to: "/farmer/buyer-matches", icon: "◎", label: "Buyer Matches", ai: true },
        { to: "/insights", icon: "◈", label: "AI Insights", ai: true },
      ],
    },
    {
      group: "General",
      items: [
        { to: "/market", icon: "◇", label: "Marketplace" },
        { to: "/messages", icon: "✉", label: "Messages", badge: "messages" },
        { to: "/profile", icon: "⚙", label: "Profile" },
      ],
    },
  ],
  buyer: [
    {
      group: "Buying",
      items: [
        { to: "/buyer", icon: "◱", label: "Dashboard", end: true },
        { to: "/market", icon: "◇", label: "Marketplace" },
        { to: "/cart", icon: "◰", label: "Cart", badge: "cart" },
        { to: "/orders", icon: "✦", label: "My Orders" },
      ],
    },
    {
      group: "Intelligence",
      items: [{ to: "/recommendations", icon: "◎", label: "AI Picks", ai: true }],
    },
    {
      group: "General",
      items: [
        { to: "/messages", icon: "✉", label: "Messages", badge: "messages" },
        { to: "/profile", icon: "⚙", label: "Profile" },
      ],
    },
  ],
  driver: [
    {
      group: "Logistics",
      items: [{ to: "/driver", icon: "◱", label: "Deliveries", end: true }],
    },
    {
      group: "General",
      items: [
        { to: "/messages", icon: "✉", label: "Messages", badge: "messages" },
        { to: "/profile", icon: "⚙", label: "Profile" },
      ],
    },
  ],
};

const ROLE_LABEL = {
  farmer: "Farmer",
  buyer: "Buyer",
  driver: "Delivery partner",
};

const ROLE_AVATAR = { farmer: "🌾", buyer: "🧺", driver: "🚚" };

export default function AppShell({ title, subtitle, actions, children }) {
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const { unread } = useMessages();
  const navigate = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const groups = NAV_BY_ROLE[user?.role] || [];

  const badgeValue = (kind) => {
    if (kind === "cart") return itemCount;
    if (kind === "messages") return unread;
    return 0;
  };

  // Close the mobile drawer whenever the route changes. Adjusting state during
  // render (rather than in an effect) avoids a second render pass.
  const [drawerRoute, setDrawerRoute] = useState(location.pathname);
  if (drawerRoute !== location.pathname) {
    setDrawerRoute(location.pathname);
    if (drawerOpen) setDrawerOpen(false);
  }

  // Don't let the page scroll behind an open drawer.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const navLink = (item, onNavigate) => {
    const count = badgeValue(item.badge);

    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        className={({ isActive }) =>
          `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
            isActive
              ? "bg-white/10 text-white"
              : "text-white/55 hover:bg-white/5 hover:text-white/90"
          }`
        }
      >
        {({ isActive }) => (
          <>
            {/* Active marker: a bright stem on the left edge. */}
            <span
              className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 transition-all duration-300 ${
                isActive ? "opacity-100" : "opacity-0"
              }`}
            />
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm transition-colors duration-200 ${
                isActive
                  ? "bg-brand-500/20 text-brand-300"
                  : "text-white/40 group-hover:text-white/70"
              }`}
            >
              {item.icon}
            </span>

            <span className="flex-1 truncate">{item.label}</span>

            {item.ai && (
              <span className="rounded-md bg-brand-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-300">
                AI
              </span>
            )}

            {item.badge && count > 0 && (
              <span className="fl-numeric min-w-5 rounded-full bg-brand-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </>
        )}
      </NavLink>
    );
  };

  const rail = (onNavigate) => (
    <>
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-6">
        <BrandMark size={36} />
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-none tracking-tight text-white">
            FarmLink <span className="text-brand-400">AI</span>
          </p>
          <p className="mt-1.5 text-[11px] font-medium text-white/40">
            {ROLE_LABEL[user?.role] || "Account"}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.group}>
            <p className="fl-eyebrow px-3 pb-2 text-white/30">{group.group}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => navLink(item, onNavigate))}
            </div>
          </div>
        ))}
      </nav>

      {/* Identity + sign out */}
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-base ring-1 ring-brand-400/20">
            {ROLE_AVATAR[user?.role] || "👤"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
            <p className="truncate text-[11px] text-white/40">{user?.email}</p>
          </div>
        </div>

        <button
          onClick={() => setConfirmLogout(true)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/55 transition-colors duration-200 hover:bg-rose-500/15 hover:text-rose-300"
        >
          <span className="flex h-7 w-7 items-center justify-center text-sm">⏻</span>
          Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas">
      {/* Desktop rail */}
      <aside className="fl-soil fixed inset-y-0 left-0 z-[600] hidden w-[264px] flex-col border-r border-white/5 lg:flex">
        <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative flex h-full flex-col">{rail()}</div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[800] lg:hidden">
          <div
            className="animate-fade-in absolute inset-0 bg-soil-950/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fl-soil animate-slide-left absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col shadow-[var(--shadow-pop)]">
            <div className="fl-grid-lines pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative flex h-full flex-col">
              {rail(() => setDrawerOpen(false))}
            </div>
          </aside>
        </div>
      )}

      <div className="lg:pl-[264px]">
        {/* Top bar */}
        <header className="fl-glass sticky top-0 z-[700] border-b border-line">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="relative rounded-xl bg-canvas px-3 py-2 text-lg text-ink-soft ring-1 ring-line transition hover:text-ink lg:hidden"
            >
              ☰
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-white" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold tracking-tight text-ink sm:text-xl">
                {title}
              </h1>
              {subtitle && (
                <p className="truncate text-xs text-ink-soft sm:text-[13px]">
                  {subtitle}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          </div>
        </header>

        {/* Keyed on the path so each route fades in rather than snapping. */}
        <main
          key={location.pathname}
          className="animate-fade-up px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10"
        >
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out of FarmLink?"
        message="You'll need to sign in again to reach your dashboard."
        confirmLabel="Log out"
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
}
