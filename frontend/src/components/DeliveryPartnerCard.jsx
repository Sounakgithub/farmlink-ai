import StartChatButton from "./StartChatButton";
import { Badge } from "./ui";
import { formatDate } from "../lib/format";

/**
 * Who is bringing this order.
 *
 * A partner is assigned as soon as the farmer accepts, so the buyer has a name
 * and a number from that moment rather than waiting for the van to move. If
 * nobody has been assigned yet the card says so plainly instead of vanishing.
 *
 * Shows name, phone, city and completed-delivery count. Nothing else off the
 * account is exposed.
 */
export default function DeliveryPartnerCard({ partner, orderId, status, compact = false }) {
  const canChat = ["In Transit"].includes(status);

  if (!partner) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-700">
          🚚 Delivery partner
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {["Pending"].includes(status)
            ? "A partner is assigned as soon as the farmer accepts your order."
            : "We are finding a delivery partner for this order."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-2xl">
            🚚
          </span>

          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Your delivery partner
            </p>
            <h4 className="truncate font-bold text-slate-900">{partner.name}</h4>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {partner.location && <>📍 {partner.location}</>}
              {partner.completedDeliveries > 0 && (
                <>
                  {partner.location ? " · " : ""}
                  {partner.completedDeliveries} deliveries completed
                </>
              )}
            </p>
          </div>
        </div>

        {status === "In Transit" && (
          <Badge className="bg-indigo-100 text-indigo-700">● On the way</Badge>
        )}
        {status === "Delivered" && (
          <Badge className="bg-green-100 text-green-700">✓ Delivered</Badge>
        )}
      </div>

      {!compact && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {partner.phone ? (
            <a
              href={`tel:${partner.phone}`}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700"
            >
              📞 {partner.phone}
            </a>
          ) : (
            <span className="text-xs text-slate-400">
              No phone number on this partner&apos;s account.
            </span>
          )}

          {canChat && (
            <StartChatButton
              kind="buyer-driver"
              orderId={orderId}
              label="💬 Message driver"
              variant="outline"
            />
          )}
        </div>
      )}

      {partner.partnerSince && !compact && (
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          FarmLink delivery partner since {formatDate(partner.partnerSince)}
        </p>
      )}
    </div>
  );
}
