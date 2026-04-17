"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/crm/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: Notification[]; unread?: number };
      setItems(data.notifications ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      /* swallow — bell is best-effort */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!popRef.current) return;
      if (popRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markAll() {
    await fetch("/api/crm/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    await load();
  }

  async function markOne(id: number) {
    await fetch("/api/crm/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    await load();
  }

  return (
    <div ref={popRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((s) => !s)}
        className="relative rounded-lg p-2 text-magic-ink/70 hover:bg-magic-red/10 hover:text-magic-red transition-all"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-magic-red text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-xl border border-magic-border bg-white shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-magic-border">
            <span className="text-sm font-semibold text-magic-ink">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAll}
                className="text-[11px] font-semibold text-magic-red hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-4 text-sm text-magic-ink/60 text-center">No notifications.</p>
            ) : (
              items.map((n) => {
                const Body = (
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-magic-ink truncate">{n.title}</div>
                    {n.body && <div className="text-xs text-magic-ink/60 truncate">{n.body}</div>}
                    <div className="text-[10px] text-magic-ink/40 mt-0.5">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                );
                return (
                  <div
                    key={n.id}
                    className={
                      "flex items-start gap-2 px-3 py-2 border-b border-magic-border/50 last:border-b-0 " +
                      (n.read_at ? "bg-white" : "bg-magic-red/5")
                    }
                  >
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => {
                          setOpen(false);
                          if (!n.read_at) markOne(n.id);
                        }}
                        className="flex-1 min-w-0"
                      >
                        {Body}
                      </Link>
                    ) : (
                      Body
                    )}
                    {!n.read_at && (
                      <button
                        onClick={() => markOne(n.id)}
                        className="text-[10px] text-magic-ink/50 hover:text-magic-red"
                        aria-label="Mark read"
                      >
                        ●
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
