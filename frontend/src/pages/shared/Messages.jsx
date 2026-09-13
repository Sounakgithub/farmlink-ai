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
      className={`relative flex w-full items-start gap-3 border-b border-line p-4 text-left transition-colors duration-200 hover:bg-canvas ${
        active ? "bg-brand-50/70" : ""
      }`}
    >
      {/* Active thread marker */}
      <span
        className={`absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500 transition-opacity duration-300 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />

      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-canvas text-lg ring-1 ring-line">
        {ROLE_ICON[convo.other?.role] || "👤"}
        {convo.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand-500 ring-2 ring-white" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate ${
              convo.unread > 0 ? "font-bold text-ink" : "font-semibold text-ink"
            }`}
          >
            {convo.other?.name || "FarmLink"}
          </p>
          <span className="shrink-0 text-[11px] text-ink-faint">
            {convo.lastMessageAt ? timeLabel(convo.lastMessageAt) : ""}
          </span>
        </div>

        <p className="truncate text-[11px] text-ink-faint">
          {convo.subject}
          {convo.kind === "buyer-farmer" ? " · price & freshness" : " · delivery"}
        </p>

        <p
          className={`mt-1 truncate text-sm ${
            convo.unread > 0 ? "font-medium text-ink-soft" : "text-ink-faint"
          }`}
        >
          {mineLast && "You: "}
          {convo.lastMessageText || "No messages yet"}
        </p>
      </div>

      {convo.unread > 0 && (
        <span className="fl-numeric mt-1 shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">
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
      <div className="fl-glass flex items-center gap-3 border-b border-line p-4">
        <button
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded-lg bg-canvas px-3 py-1.5 text-sm font-semibold text-ink-soft ring-1 ring-line transition hover:text-ink lg:hidden"
        >
          ←
        </button>

        <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-canvas text-lg ring-1 ring-line">
          {ROLE_ICON[thread.other?.role] || "👤"}
          {/* Presence is not tracked on the server, so this marks the thread as
              open rather than claiming the other person is online. */}
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-brand-500 ring-2 ring-white" />
        </span>

        <div className="min-w-0">
          <p className="truncate font-bold text-ink">
            {thread.other?.name || "FarmLink"}
          </p>
          <p className="truncate text-xs text-ink-soft">
            {thread.subject}
            {thread.kind === "buyer-farmer"
              ? " · freshness & price"
              : " · delivery instructions"}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2.5 overflow-y-auto bg-canvas p-4">
        {thread.messages.length === 0 && (
          <div className="mx-auto mt-8 max-w-xs text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl ring-1 ring-brand-100">
              ✉
            </span>
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              {thread.kind === "buyer-farmer"
                ? "Ask about freshness, harvest date or negotiate a price."
                : "Share any delivery instructions with your delivery partner."}
            </p>
          </div>
        )}

        {thread.messages.map((msg, i) => {
          const mine = String(msg.senderId) === String(meId);
          const previous = thread.messages[i - 1];
          // Consecutive messages from one person read as a block: only the
          // first in a run carries the name and the full corner radius.
          const grouped =
            previous && String(previous.senderId) === String(msg.senderId);

          return (
            <div
              key={msg._id || i}
              className={`animate-fade-up flex ${
                mine ? "justify-end" : "justify-start"
              } ${grouped ? "mt-0.5" : "mt-3"}`}
            >
              <div
                className={`max-w-[80%] px-4 py-2.5 text-sm shadow-sm sm:max-w-[70%] ${
                  mine
                    ? `bg-brand-600 text-white ${
                        grouped ? "rounded-2xl rounded-br-md" : "rounded-2xl rounded-br-md"
                      }`
                    : `bg-surface text-ink ring-1 ring-line ${
                        grouped ? "rounded-2xl rounded-bl-md" : "rounded-2xl rounded-bl-md"
                      }`
                }`}
              >
                {!mine && !grouped && (
                  <p className="mb-1 text-[11px] font-bold text-brand-700">
                    {msg.senderName}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words leading-relaxed">
                  {msg.body}
                </p>
                <p
                  className={`mt-1 text-[10px] ${
                    mine ? "text-white/60" : "text-ink-faint"
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
        <div className="fl-scrollbar-none flex gap-2 overflow-x-auto border-t border-line bg-surface px-4 py-2.5">
          {chips.map((chip) => (
            <button
              key={chip}
              onClick={() => send(chip)}
              disabled={sending}
              className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-semibold text-ink-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
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
        className="flex items-end gap-2 border-t border-line bg-surface p-3"
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
          className="max-h-32 flex-1 resize-none rounded-xl border border-line-strong bg-canvas px-4 py-2.5 text-sm text-ink outline-none transition duration-200 placeholder:text-ink-faint focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-brand-500/12"
        />
        <Button
          type="submit"
          disabled={!draft.trim()}
          loading={sending}
          className="py-2.5"
          aria-label="Send message"
        >
          {sending ? "" : "Send"}
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

      <div className="fl-card overflow-hidden">
        <div className="grid lg:grid-cols-[340px_1fr]">
          {/* Conversation list */}
          <div
            className={`border-line lg:border-r ${
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
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-faint">
                Select a conversation to start chatting
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
