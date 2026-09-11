import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useMessages } from "../context/MessagesContext";
import { Button } from "./ui";

/**
 * Opens (or reuses) a conversation and jumps to the thread.
 *
 * props: { kind, productId?, orderId?, buyerId?, label?, variant?, className? }
 *   kind    = "buyer-farmer" | "buyer-driver"
 *   buyerId = only when a FARMER opens a thread from their own listing
 *             (the AI matching results); ignored for every other flow.
 */
export default function StartChatButton({
  kind,
  productId,
  orderId,
  buyerId,
  label = "💬 Message",
  variant = "outline",
  className = "",
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useMessages();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const { conversation } = await api.post("/conversations", {
        kind,
        productId,
        orderId,
        buyerId,
      });
      await refresh();
      navigate(`/messages/${conversation._id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={variant} className={className} onClick={open} disabled={busy}>
      {busy ? "Opening…" : label}
    </Button>
  );
}
