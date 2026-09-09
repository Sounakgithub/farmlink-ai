import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { Button, EmptyState, ErrorNote, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useMessages } from "../../context/MessagesContext";
import { formatDate } from "../../lib/format";

const ROLE_ICON = { farmer: "👨‍🌾", buyer: "🧑‍🍳", driver: "🚚", system: "🌾" };

// Buyer-side quick replies, tuned to what each chat is for.
const QUICK_REPLIES = {
  "buyer-farmer": [
    "How fresh is this produce?",
    "When was it harvested?",
    "Can you do a better price for a bulk order?",
    "Is the quantity shown still available?",
  ],
  "buyer-driver": [
    "Please call me when you arrive.",
    "Leave it with the security guard.",
    "Use the back entrance / service lift.",
    "I might be 10 minutes late — please wait.",
  ],
};

function timeLabel(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : formatDate(iso);
}

function ConversationRow({ convo, active, onClick, meId }) {
  const mineLast = String(convo.lastSenderId) === String(meId);
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b border-slate-100 p-4 text-left transition hover:bg-slate-50 ${
        active ? "bg-emerald-50" : ""
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg">
        {ROLE_ICON[convo.other?.role] || "👤"}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-semibold text-slate-900">
            {convo.other?.name || "FarmLink"}
          </p>
          <span className="shrink-0 text-[11px] text-slate-400">
            {convo.lastMessageAt ? timeLabel(convo.lastMessageAt) : ""}
          </span>
        </div>

        <p className="truncate text-xs text-slate-500">
          {convo.subject}
          {convo.kind === "buyer-farmer" ? " · price & freshness" : " · delivery"}
        </p>

        <p className="mt-1 truncate text-sm text-slate-500">
          {mineLast && "You: "}
          {convo.lastMessageText || "No messages yet"}
        </p>
      </div>

      {convo.unread > 0 && (
        <span className="mt-1 shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
          {convo.unread}
        </span>
      )}
    </button>
  );
}

function Thread({ id, meId, onActivity, onBack }) {
  const toast = useToast();
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const activityRef = useRef(onActivity);
  useEffect(() => {
    activityRef.current = onActivity;
  });

  // Manual retry from the error state.
  const retry = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/conversations/${id}`);
      setThread(data);
      setError("");
      activityRef.current?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    let first = true;

    const fetchThread = async () => {
      try {
        const data = await api.get(`/conversations/${id}`);
        if (!alive) return;
        setThread(data);
        setError("");
        if (first) {
          first = false;
          activityRef.current?.(); // opening a thread clears its unread count
        }
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchThread();
    const timer = setInterval(fetchThread, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages?.length]);

  const send = async (text) => {
    const body = (text ?? draft).trim();
    if (!body || sending) return;

    setSending(true);
    try {
      const data = await api.post(`/conversations/${id}/messages`, { body });
      setThread((current) => ({
        ...current,
        messages: [...(current?.messages || []), data.message],
      }));
      setDraft("");
      activityRef.current?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner label="Loading conversation…" />;
  if (error) return <ErrorNote message={error} onRetry={retry} />;
  if (!thread) return null;

  // The buyer side sees quick replies. In both thread kinds the buyer's
  // counterpart is the farmer or the driver, which identifies the buyer side.
  const showChips =
    thread.other?.role === "farmer" || thread.other?.role === "driver";
  const chips = QUICK_REPLIES[thread.kind] || [];

  return (
    <div className="flex h-full flex-col">
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-slate-200 p-4">
        <button
          onClick={onBack}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600 lg:hidden"
        >
          ←
        </button>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg">
          {ROLE_ICON[thread.other?.role] || "👤"}
        </span>
        <div className="min-w-0">
          <p className="truncate font-bold text-slate-900">
            {thread.other?.name || "FarmLink"}
          </p>
          <p className="truncate text-xs text-slate-500">
            {thread.subject}
            {thread.kind === "buyer-farmer"
              ? " · freshness & price negotiation"
              : " · delivery instructions"}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
        {thread.messages.length === 0 && (
          <p className="mx-auto max-w-xs rounded-xl bg-white p-4 text-center text-sm text-slate-400">
            {thread.kind === "buyer-farmer"
              ? "Ask about freshness, harvest date or negotiate a price."
              : "Share any delivery instructions with your delivery partner."}
          </p>
        )}

        {thread.messages.map((msg, i) => {
          const mine = String(msg.senderId) === String(meId);
          return (
            <div
              key={msg._id || i}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                  mine
                    ? "rounded-br-md bg-emerald-600 text-white"
                    : "rounded-bl-md bg-white text-slate-800"
                }`}
              >
                {!mine && (
                  <p className="mb-0.5 text-xs font-semibold text-slate-500">
                    {msg.senderName}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <p
                  className={`mt-1 text-[10px] ${
                    mine ? "text-emerald-100" : "text-slate-400"
                  }`}
                >
                  {timeLabel(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies */}
      {showChips && chips.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-slate-100 bg-white px-4 py-2">
          {chips.map((chip) => (
            <button
              key={chip}
              onClick={() => send(chip)}
              disabled={sending}
              className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 border-t border-slate-200 bg-white p-3"
      >
        <textarea
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Write a message…"
          className="max-h-32 flex-1 resize-none rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
        <Button type="submit" disabled={sending || !draft.trim()} className="py-2.5">
          {sending ? "…" : "Send"}
        </Button>
      </form>
    </div>
  );
}

export default function Messages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh } = useMessages();

  const [convos, setConvos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  const loadList = useCallback(async () => {
    try {
      const data = await api.get("/conversations");
      setConvos(data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    const fetchList = async () => {
      try {
        const data = await api.get("/conversations");
        if (alive) {
          setConvos(data);
          setError("");
        }
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchList();
    const timer = setInterval(fetchList, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const onThreadActivity = useCallback(() => {
    loadList();
    refreshRef.current?.();
  }, [loadList]);

  return (
    <AppShell title="Messages" subtitle="Chat with farmers and delivery partners">
      {error && <ErrorNote message={error} onRetry={loadList} />}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid lg:grid-cols-[340px_1fr]">
          {/* Conversation list */}
          <div
            className={`border-slate-200 lg:border-r ${
              id ? "hidden lg:block" : "block"
            }`}
          >
            {loading ? (
              <Spinner label="Loading chats…" />
            ) : convos.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon="💬"
                  title="No conversations yet"
                  description={
                    user?.role === "buyer"
                      ? "Message a farmer from the marketplace, or your delivery partner from an active order."
                      : user?.role === "farmer"
                      ? "Buyers can message you about your crops — replies will show up here."
                      : "Buyers you're delivering to can message you here."
                  }
                />
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto">
                {convos.map((convo) => (
                  <ConversationRow
                    key={convo._id}
                    convo={convo}
                    meId={user?.id}
                    active={String(convo._id) === String(id)}
                    onClick={() => navigate(`/messages/${convo._id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Active thread */}
          <div className={`h-[70vh] ${id ? "block" : "hidden lg:block"}`}>
            {id ? (
              <Thread
                key={id}
                id={id}
                meId={user?.id}
                onActivity={onThreadActivity}
                onBack={() => navigate("/messages")}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
                Select a conversation to start chatting
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
