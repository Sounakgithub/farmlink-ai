import { Badge, Button } from "./ui";
import { currency, cropIcon } from "../lib/format";
import { distanceBetween, freshnessFor } from "../lib/produce";

/**
 * The marketplace unit.
 *
 * Everything on the face of this card is derived from data the product
 * actually carries — listing age, stock, the farmer's city against the
 * viewer's — rather than invented ratings. Where a figure cannot be worked
 * out (an unmappable city, say) the row simply does not render, instead of
 * showing a made-up number.
 */
export default function ProductCard({
  product,
  viewerLocation,
  inCart = false,
  canBuy = true,
  onChoose,
  badge,
  footer,
  className = "",
}) {
  const soldOut = (product.quantity ?? 0) <= 0;
  const fresh = freshnessFor(product.createdAt);
  const distanceKm = distanceBetween(viewerLocation, product.location);

  return (
    <article
      className={`fl-card fl-card-interactive group flex flex-col overflow-hidden ${className}`}
    >
      {/* ---- crop plate ---- */}
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br from-brand-50 via-brand-100/70 to-harvest-50">
        {/* A faint furrow pattern so the plate is not a flat block of colour. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(115deg, var(--color-brand-900) 0 1px, transparent 1px 14px)",
          }}
        />

        {product.image ? (
          <img
            src={product.image}
            alt={product.cropName}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="relative text-[3.25rem] transition-transform duration-500 group-hover:scale-110">
            {cropIcon(product.cropName)}
          </span>
        )}

        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {badge}
          {fresh && !soldOut && (
            <Badge className={fresh.className}>{fresh.label}</Badge>
          )}
        </div>

        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
            <Badge tone="rose" className="text-sm">
              Sold out
            </Badge>
          </div>
        )}
      </div>

      {/* ---- detail ---- */}
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-[17px] font-bold tracking-tight text-ink">
          {product.cropName}
        </h3>
        <p className="mt-0.5 truncate text-xs text-ink-soft">
          {product.farmerName} · {product.location}
        </p>

        <dl className="mt-4 flex-1 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-faint">Available</dt>
            <dd className="fl-numeric font-semibold text-ink">
              {(product.quantity ?? 0).toLocaleString("en-IN")} {product.unit || "kg"}
            </dd>
          </div>

          {distanceKm != null && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-faint">Distance</dt>
              <dd className="fl-numeric font-semibold text-ink">
                {distanceKm < 1 ? "< 1" : Math.round(distanceKm)} km
              </dd>
            </div>
          )}

          {fresh && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-faint">Listed</dt>
              <dd className="font-semibold text-ink">{fresh.listed}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-4">
          <p className="fl-numeric text-2xl font-bold text-ink">
            {currency(product.pricePerKg)}
            <span className="ml-1 text-xs font-medium text-ink-faint">/ kg</span>
          </p>
        </div>

        {footer ||
          (canBuy ? (
            <Button
              onClick={() => onChoose?.(product)}
              disabled={soldOut}
              variant={inCart ? "outline" : "primary"}
              className="mt-4 w-full"
            >
              {soldOut ? "Sold out" : inCart ? "✓ In cart — add more" : "Add to cart"}
            </Button>
          ) : (
            <p className="mt-4 rounded-lg bg-canvas py-2.5 text-center text-xs text-ink-faint">
              Sign in as a buyer to order
            </p>
          ))}
      </div>
    </article>
  );
}
