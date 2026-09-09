import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { useMessages } from "../context/MessagesContext";
import { Button } from "./ui";

/**
 * Opens (or reuses) a conversation and jumps to the thread.
 *
 * props: { kind, productId?, orderId?, label?, variant?, className? }
 *   kind = "buyer-farmer" | "buyer-driver"
 */
export default function StartChatButton({
  kind,
  productId,
  orderId,
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
