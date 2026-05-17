"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface InboxMessage {
  id: number;
  lead_id: number | null;
  sender_id: number | null;
  sender_username: string | null;
  sender_name: string | null;
  kind: string;
  subject: string;
  body: string;
  read_at: string | null;
  created_at: string;
  lead_ref: string | null;
  lead_title: string | null;
  lead_status: string | null;
}

const KIND_LABEL: Record<string, string> = {
  lead_assigned: "Lead assigned",
  quotation_sent_to_sales: "Quotation",
  won: "Won",
  lost: "Lost",
  boq_sent_to_execution: "Execution",
  general: "Update",
};

const KIND_COLOR: Record<string, string> = {
  lead_assigned: "bg-indigo-100 text-indigo-800",
  quotation_sent_to_sales: "bg-amber-100 text-amber-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-red-100 text-red-800",
  boq_sent_to_execution: "bg-cyan-100 text-cyan-800",
  general: "bg-slate-100 text-slate-800",
};

export default function LeadInboxClient() {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refetch() {
    setLoading(true);
    setError(null);
    try {
      const url = filter === "unread" ? "/api/leads/inbox?unread=1" : "/api/leads/inbox";
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as { messages?: InboxMessage[]; error?: string };
      if (data.error) {
        setError(data.error);
        setMessages([]);
      } else {
        setMessages(data.messages ?? []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId],
  );

  async function markRead(id: number, read: boolean) {
    try {
      await fetch(`/api/leads/inbox/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read }),
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, read_at: read ? new Date().toISOString() : null } : m,
        ),
      );
    } catch {
      // silent — UI will catch up on next refetch
    }
  }

  function open(m: InboxMessage) {
    setSelectedId(m.id);
    if (!m.read_at) void markRead(m.id, true);
  }

  const unreadCount = messages.filter((m) => !m.read_at).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
            filter === "all"
              ? "border-magic-ink/40 bg-magic-ink/5 text-magic-ink"
              : "border-magic-border bg-white text-magic-ink/60 hover:bg-magic-soft"
          }`}
        >
          All ({messages.length})
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
            filter === "unread"
              ? "border-magic-red/40 bg-magic-red/10 text-magic-red"
              : "border-magic-border bg-white text-magic-ink/60 hover:bg-magic-soft"
          }`}
        >
          Unread ({unreadCount})
        </button>
        <button
          onClick={() => void refetch()}
          className="ml-auto rounded-lg border border-magic-border bg-white px-3 py-1 text-xs font-semibold text-magic-ink hover:bg-magic-soft"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="overflow-hidden rounded-xl border border-magic-border bg-white shadow-sm lg:col-span-1">
          {loading && (
            <p className="px-3 py-6 text-center text-sm text-magic-ink/50">
              Loading…
            </p>
          )}
          {!loading && messages.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-magic-ink/50">
              Inbox is empty.
            </p>
          )}
          <ul className="divide-y divide-magic-border/40 max-h-[70vh] overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => open(m)}
                  className={`block w-full text-left transition-colors ${
                    selectedId === m.id
                      ? "bg-magic-soft"
                      : m.read_at
                        ? "bg-white hover:bg-magic-soft/40"
                        : "bg-magic-red/5 hover:bg-magic-red/10"
                  }`}
                >
                  <div className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${KIND_COLOR[m.kind] ?? "bg-slate-100 text-slate-800"}`}
                      >
                        {KIND_LABEL[m.kind] ?? m.kind}
                      </span>
                      <span className="text-[10px] text-magic-ink/40">
                        {new Date(m.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div
                      className={`mt-1 line-clamp-2 text-sm ${
                        m.read_at ? "text-magic-ink/70" : "font-semibold text-magic-ink"
                      }`}
                    >
                      {m.subject}
                    </div>
                    <div className="mt-0.5 text-[11px] text-magic-ink/50">
                      from {m.sender_name || m.sender_username || "System"}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-magic-border bg-white p-5 shadow-sm lg:col-span-2">
          {!selected && (
            <p className="text-center text-sm text-magic-ink/50">
              Pick a message to read.
            </p>
          )}
          {selected && (
            <article>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-magic-ink">
                    {selected.subject}
                  </h2>
                  <div className="mt-1 text-xs text-magic-ink/60">
                    From{" "}
                    <span className="font-semibold">
                      {selected.sender_name || selected.sender_username || "System"}
                    </span>{" "}
                    · {new Date(selected.created_at).toLocaleString()}
                  </div>
                  {selected.lead_ref && (
                    <div className="mt-1 text-xs">
                      <Link
                        href={`/leads/${selected.lead_id}`}
                        className="font-mono text-magic-red hover:underline"
                      >
                        {selected.lead_ref}
                      </Link>
                      {selected.lead_title && (
                        <span className="text-magic-ink/60"> — {selected.lead_title}</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void markRead(selected.id, !selected.read_at)}
                  className="rounded-lg border border-magic-border bg-white px-2.5 py-1 text-[11px] font-semibold text-magic-ink hover:bg-magic-soft"
                >
                  Mark {selected.read_at ? "unread" : "read"}
                </button>
              </div>
              <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-magic-ink/85">
                {selected.body}
              </pre>
              {selected.lead_id && (
                <div className="mt-4 border-t border-magic-border/60 pt-3">
                  <Link
                    href={`/leads/${selected.lead_id}`}
                    className="inline-block rounded-lg bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90"
                  >
                    Open lead →
                  </Link>
                </div>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
