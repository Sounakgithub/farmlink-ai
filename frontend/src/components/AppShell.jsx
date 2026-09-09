import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCart } from "../context/CartContext";
import { useMessages } from "../context/MessagesContext";
import { ConfirmDialog } from "./ui";

// Each role only sees the tools that belong to it.
const NAV_BY_ROLE = {
  farmer: [
    { to: "/farmer", icon: "📊", label: "Dashboard", end: true },
    { to: "/farmer/products", icon: "🌱", label: "My Crops" },
    { to: "/farmer/orders", icon: "📦", label: "Orders" },
    { to: "/messages", icon: "💬", label: "Messages", badge: "messages" },
    { to: "/insights", icon: "🤖", label: "AI Insights" },
    { to: "/market", icon: "🛒", label: "Marketplace" },
    { to: "/profile", icon: "⚙️", label: "Profile" },
  ],
  buyer: [
    { to: "/buyer", icon: "📊", label: "Dashboard", end: true },
    { to: "/market", icon: "🛒", label: "Marketplace" },
    { to: "/cart", icon: "🧺", label: "Cart", badge: "cart" },
    { to: "/orders", icon: "📦", label: "My Orders" },
    { to: "/messages", icon: "💬", label: "Messages", badge: "messages" },
    { to: "/profile", icon: "⚙️", label: "Profile" },
  ],
  driver: [
    { to: "/driver", icon: "🚚", label: "Deliveries", end: true },
    { to: "/messages", icon: "💬", label: "Messages", badge: "messages" },
    { to: "/profile", icon: "⚙️", label: "Profile" },
  ],
};

const ROLE_LABEL = {
  farmer: "Farmer account",
  buyer: "Buyer account",
  driver: "Delivery partner",
};

const ROLE_AVATAR = { farmer: "👨‍🌾", buyer: "🧑‍🍳", driver: "🚚" };

export default function AppShell({ title, subtitle, actions, children }) {
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const { unread } = useMessages();
  const navigate = useNavigate();
  const location = useLocation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const navItems = NAV_BY_ROLE[user?.role] || [];

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

  const navLink = (item, onClick) => {
    const count = badgeValue(item.badge);
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onClick}
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition ${
            isActive
              ? "bg-emerald-600 text-white shadow"
              : "text-emerald-100 hover:bg-emerald-900"
          }`
        }
      >
        <span className="text-base">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        {item.badge && count > 0 && (
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-emerald-700">
            {count}
          </span>
        )}
      </NavLink>
    );
  };

  const sidebarContent = (onNavigate) => (
    <>
      <div className="flex items-center gap-3 border-b border-emerald-900 px-5 py-6">
        <span className="text-3xl">🌾</span>
        <div>
          <h1 className="text-lg font-bold text-white">FarmLink AI</h1>
          <p className="text-xs text-emerald-300">{ROLE_LABEL[user?.role]}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => navLink(item, onNavigate))}
      </nav>

      <div className="border-t border-emerald-900 p-3">
        <div className="mb-2 flex items-center gap-3 rounded-xl bg-emerald-900/60 px-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-lg">
            {ROLE_AVATAR[user?.role] || "👤"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{user?.name}</p>
            <p className="truncate text-xs text-emerald-300">{user?.email}</p>
          </div>
        </div>

        <button
          onClick={() => setConfirmLogout(true)}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-red-600 hover:text-white"
        >
          <span>🚪</span> Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-emerald-950 lg:flex">
        {sidebarContent()}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[800] lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-emerald-950 shadow-2xl">
            {sidebarContent(() => setDrawerOpen(false))}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-[700] border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="relative rounded-xl bg-slate-100 px-3 py-2 text-lg lg:hidden"
            >
              ☰
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold text-slate-900 sm:text-xl">
                {title}
              </h2>
              {subtitle && (
                <p className="truncate text-xs text-slate-500 sm:text-sm">{subtitle}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {actions}

              <button
                onClick={() => setConfirmLogout(true)}
                className="hidden rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-red-50 hover:text-red-600 sm:inline-flex"
              >
                🚪 Log out
              </button>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</main>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        message="You'll need to sign in again to access your dashboard."
        confirmLabel="Log out"
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
}
