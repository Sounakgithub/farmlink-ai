import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import BuyModal from "../../components/BuyModal";
import {
  Button,
  EmptyState,
  ErrorNote,
  Segmented,
  SkeletonCards,
} from "../../components/ui";
import ProductCard from "../../components/ProductCard";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { cropIcon } from "../../lib/format";

const SORTS = {
  newest: { label: "Newest first", fn: (a, b) => new Date(b.createdAt) - new Date(a.createdAt) },
  priceLow: { label: "Price: low to high", fn: (a, b) => a.pricePerKg - b.pricePerKg },
  priceHigh: { label: "Price: high to low", fn: (a, b) => b.pricePerKg - a.pricePerKg },
  stock: { label: "Most available", fn: (a, b) => b.quantity - a.quantity },
};

export default function BuyerMarketplace() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isInCart, itemCount } = useCart();

  const {
    data: products,
    loading,
    error,
    reload,
  } = useAsyncData(() => api.get("/products", { auth: false }), {
    initialData: [],
  });

  const [search, setSearch] = useState("");
  const [crop, setCrop] = useState("All");
  const [sort, setSort] = useState("newest");
  const [buying, setBuying] = useState(null);

  const isBuyer = user?.role === "buyer";

  const cropNames = useMemo(
    () => ["All", ...new Set(products.map((p) => p.cropName))],
    [products]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return products
      .filter((p) => {
        const matchesSearch =
          !term ||
          p.cropName.toLowerCase().includes(term) ||
          p.farmerName.toLowerCase().includes(term) ||
          p.location.toLowerCase().includes(term);

        const matchesCrop = crop === "All" || p.cropName === crop;

        return matchesSearch && matchesCrop;
      })
      .sort(SORTS[sort].fn);
  }, [products, search, crop, sort]);

  const activeFilters = search || crop !== "All";

  return (
    <AppShell
      title="Marketplace"
      subtitle={
        isBuyer
          ? "Fresh produce, direct from the farm"
          : "See how your crops compare with other farms"
      }
      actions={
        isBuyer && (
          <Button onClick={() => navigate("/cart")} className="whitespace-nowrap">
            🧺 Cart{itemCount > 0 ? ` · ${itemCount}` : ""}
          </Button>
        )
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} className="mb-6" />}

      {/* ---- search + sort ---- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="group relative flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint transition-colors group-focus-within:text-brand-600">
            🔍
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crops, farmers or locations…"
            aria-label="Search the marketplace"
            className="w-full rounded-xl border border-line-strong bg-surface py-3 pl-11 pr-4 text-sm text-ink outline-none transition duration-200 placeholder:text-ink-faint focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-canvas px-2 py-1 text-xs text-ink-soft transition hover:bg-line"
            >
              ✕
            </button>
          )}
        </div>

        <Segmented
          className="self-start lg:self-auto"
          value={sort}
          onChange={setSort}
          options={[
            { value: "newest", label: "Newest" },
            { value: "priceLow", label: "₹ Low" },
            { value: "priceHigh", label: "₹ High" },
            { value: "stock", label: "Stock" },
          ]}
        />
      </div>

      {/* ---- crop chips ---- */}
      <div className="fl-scrollbar-none -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
        {cropNames.map((name) => {
          const active = crop === name;
          return (
            <button
              key={name}
              onClick={() => setCrop(name)}
              aria-pressed={active}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-all duration-200 ${
                active
                  ? "border-brand-600 bg-brand-600 text-white shadow-[0_4px_14px_-4px_rgba(22,163,74,.6)]"
                  : "border-line bg-surface text-ink-soft hover:border-brand-200 hover:text-ink"
              }`}
            >
              <span>{name === "All" ? "🌱" : cropIcon(name)}</span>
              {name === "All" ? "All crops" : name}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          <span className="fl-numeric font-bold text-ink">{visible.length}</span>{" "}
          listing{visible.length === 1 ? "" : "s"}
          {activeFilters ? " match your filters" : " available"}
        </p>

        {activeFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setCrop("All");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* ---- grid ---- */}
      <div className="mt-5">
        {loading ? (
          <SkeletonCards count={8} className="lg:grid-cols-3 2xl:grid-cols-4" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="🔎"
            title="Nothing matches that"
            description={
              activeFilters
                ? "Try a different crop or a broader search term."
                : "No produce is listed right now. Farmers add fresh stock every day."
            }
            action={
              activeFilters && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setCrop("All");
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((product, index) => (
              <div
                key={product._id}
                className="animate-fade-up"
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              >
                <ProductCard
                  product={product}
                  viewerLocation={user?.location}
                  inCart={isInCart(product._id)}
                  canBuy={isBuyer}
                  onChoose={setBuying}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <BuyModal product={buying} open={!!buying} onClose={() => setBuying(null)} />
    </AppShell>
  );
}
