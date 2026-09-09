import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import BuyModal from "../../components/BuyModal";
import { Badge, Button, EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAsyncData } from "../../lib/useAsyncData";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { currency, cropIcon } from "../../lib/format";

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

  return (
    <AppShell
      title="Marketplace"
      subtitle={
        isBuyer
          ? "Fresh produce, direct from farmers"
          : "See how your crops compare with other farms"
      }
      actions={
        isBuyer && (
          <Button onClick={() => navigate("/cart")} className="whitespace-nowrap">
            🧺 Cart{itemCount > 0 ? ` (${itemCount})` : ""}
          </Button>
        )
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}

      {/* Search + filters */}
      <div className="mb-6 flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crops, farmers or locations…"
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:flex">
          <select
            value={crop}
            onChange={(e) => setCrop(e.target.value)}
            aria-label="Filter by crop"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none focus:border-emerald-500"
          >
            {cropNames.map((name) => (
              <option key={name} value={name}>
                {name === "All" ? "🌱 All crops" : name}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort products"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium outline-none focus:border-emerald-500"
          >
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mb-5 text-sm text-slate-500">
        {visible.length} product{visible.length === 1 ? "" : "s"} available
      </p>

      {loading ? (
        <Spinner label="Loading the marketplace…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No products found"
          description="Try a different search term or crop filter."
          action={
            (search || crop !== "All") && (
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
          {visible.map((product) => {
            const soldOut = product.quantity <= 0;
            const inCart = isInCart(product._id);

            return (
              <article
                key={product._id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex h-32 items-center justify-center bg-gradient-to-br from-emerald-50 to-green-100">
                  <span className="text-5xl transition group-hover:scale-110">
                    {cropIcon(product.cropName)}
                  </span>
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-lg font-bold text-slate-900">
                      {product.cropName}
                    </h3>

                    <Badge
                      className={
                        soldOut
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }
                    >
                      {soldOut ? "Sold out" : "Available"}
                    </Badge>
                  </div>

                  <div className="mt-3 flex-1 space-y-1.5 text-sm text-slate-600">
                    <p className="truncate">👨‍🌾 {product.farmerName}</p>
                    <p className="truncate">📍 {product.location}</p>
                    <p>📦 {product.quantity} {product.unit} available</p>
                  </div>

                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="text-2xl font-bold text-emerald-600">
                      {currency(product.pricePerKg)}
                      <span className="ml-1 text-xs font-medium text-slate-500">
                        / kg
                      </span>
                    </p>

                    {isBuyer ? (
                      <Button
                        onClick={() => setBuying(product)}
                        disabled={soldOut}
                        variant={inCart ? "outline" : "primary"}
                        className="mt-4 w-full py-3"
                      >
                        {soldOut
                          ? "Sold out"
                          : inCart
                          ? "✓ In cart — buy more"
                          : "Choose quantity"}
                      </Button>
                    ) : (
                      <p className="mt-4 text-center text-xs text-slate-400">
                        Sign in as a buyer to order
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <BuyModal product={buying} open={!!buying} onClose={() => setBuying(null)} />
    </AppShell>
  );
}
