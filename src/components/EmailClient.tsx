"use client";

import { useCallback, useEffect, useState } from "react";

interface MessageSummary {
  uid: number;
  subject: string;
  from: string;
  date: string | null;
  seen: boolean;
}

interface MessageDetail extends MessageSummary {
  to: string;
  text: string;
  html: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export default function EmailClient() {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInit, setComposeInit] = useState<{
    to: string;
    subject: string;
  }>({ to: "", subject: "" });

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/email/messages?limit=40", {
        cache: "no-store",
      });
      const d = await r.json();
      if (r.status === 409 && d.notConfigured) {
        setNotConfigured(true);
        return;
      }
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setNotConfigured(false);
      setMessages(Array.isArray(d.messages) ? d.messages : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  async function openMessage(uid: number) {
    setLoadingMsg(true);
    setSelected(null);
    setError(null);
    try {
      const r = await fetch(`/api/email/messages/${uid}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setSelected(d.message as MessageDetail);
      setMessages((prev) =>
        prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m)),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMsg(false);
    }
  }

  function compose(to = "", subject = "") {
    setComposeInit({ to, subject });
    setComposeOpen(true);
  }

  if (notConfigured) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-10 text-center">
        <p className="text-sm text-magic-ink/70">
          No mailbox is assigned to your account yet. Ask an admin to set one up
          in <b>Admin → Email</b>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => compose()}
          className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Compose
        </button>
        <button
          onClick={() => void loadInbox()}
          disabled={loading}
          className="rounded-lg border border-magic-border px-4 py-2 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* Inbox list */}
        <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
          <div className="border-b border-magic-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-magic-ink/60">
            Inbox
          </div>
          <ul className="max-h-[70vh] divide-y divide-magic-border/60 overflow-y-auto">
            {loading && messages.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-magic-ink/40 animate-pulse">
                Loading inbox…
              </li>
            ) : messages.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-magic-ink/40">
                Inbox is empty.
              </li>
            ) : (
              messages.map((m) => (
                <li key={m.uid}>
                  <button
                    onClick={() => void openMessage(m.uid)}
                    className={`block w-full px-4 py-2.5 text-left transition-colors hover:bg-magic-soft/40 ${
                      selected?.uid === m.uid ? "bg-magic-soft/60" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm ${
                          m.seen
                            ? "text-magic-ink/70"
                            : "font-semibold text-magic-ink"
                        }`}
                      >
                        {m.from || "(unknown sender)"}
                      </span>
                      <span className="shrink-0 text-[10px] text-magic-ink/40">
                        {fmtDate(m.date).split(",")[0]}
                      </span>
                    </div>
                    <div
                      className={`truncate text-xs ${
                        m.seen ? "text-magic-ink/50" : "text-magic-ink/80"
                      }`}
                    >
                      {m.subject}
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Reader */}
        <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
          {loadingMsg ? (
            <div className="p-10 text-center text-sm text-magic-ink/40 animate-pulse">
              Loading message…
            </div>
          ) : !selected ? (
            <div className="p-10 text-center text-sm text-magic-ink/40">
              Select a message to read it.
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-magic-border px-5 py-3">
                <div className="text-base font-bold text-magic-ink">
                  {selected.subject}
                </div>
                <div className="mt-1 text-xs text-magic-ink/60">
                  <div>
                    <b>From:</b> {selected.from}
                  </div>
                  {selected.to && (
                    <div>
                      <b>To:</b> {selected.to}
                    </div>
                  )}
                  <div>{fmtDate(selected.date)}</div>
                </div>
                <button
                  onClick={() =>
                    compose(
                      selected.from,
                      selected.subject.startsWith("Re:")
                        ? selected.subject
                        : `Re: ${selected.subject}`,
                    )
                  }
                  className="mt-2 rounded-md border border-magic-red px-3 py-1 text-xs font-semibold text-magic-red hover:bg-magic-red hover:text-white"
                >
                  Reply
                </button>
              </div>
              <div className="min-h-[40vh] flex-1 overflow-auto p-5">
                {selected.html ? (
                  // Email HTML is untrusted — render it in a fully sandboxed
                  // iframe (no scripts, no same-origin) so it can never run code.
                  <iframe
                    title="Message body"
                    sandbox=""
                    srcDoc={selected.html}
                    className="h-[60vh] w-full border-0"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm text-magic-ink/90">
                    {selected.text || "(no content)"}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {composeOpen && (
        <Composer
          initialTo={composeInit.to}
          initialSubject={composeInit.subject}
          onClose={() => setComposeOpen(false)}
          onSent={() => setComposeOpen(false)}
        />
      )}
    </div>
  );
}

function Composer({
  initialTo,
  initialSubject,
  onClose,
  onSent,
}: {
  initialTo: string;
  initialSubject: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), text }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDone(true);
      setTimeout(onSent, 700);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-magic-ink">New message</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ×
          </button>
        </div>
        <input
          className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="To (comma-separate multiple)"
        />
        <input
          className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
        />
        <textarea
          rows={10}
          className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm focus:border-magic-red focus:outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your message…"
        />
        {err && (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {done && (
            <span className="text-sm font-semibold text-emerald-700">Sent ✓</span>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded border border-magic-border px-3 py-1.5 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void send()}
            disabled={busy || !to.trim()}
            className="rounded bg-magic-red px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
