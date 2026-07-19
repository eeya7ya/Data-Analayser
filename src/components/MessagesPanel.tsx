"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, MessageSquare, Check, X, CheckCheck } from "@/lib/icons";
import Spinner from "@/components/Spinner";
import type { NotificationItem } from "@/app/api/notifications/route";

/**
 * Dashboard inbox — the "side" panel the V1.3a spec asks for. Shows the
 * same feed as the TopBar bell split into Alarms and Messages tabs, with
 * per-item "mark read" and "remove", plus "mark all read". State is
 * persisted via POST /api/notifications so it survives reloads.
 */

const SEVERITY_DOT: Record<NotificationItem["severity"], string> = {
  critical: "bg-magic-red",
  warning: "bg-amber-500",
  info: "bg-blue-500",
};

export default function MessagesPanel() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [tab, setTab] = useState<"alarms" | "messages">("alarms");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items?: NotificationItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function setState(key: string, status: "read" | "removed") {
    setBusyKey(key);
    // Optimistic update.
    setItems((prev) => {
      if (!prev) return prev;
      if (status === "removed") return prev.filter((i) => i.id !== key);
      return prev.map((i) => (i.id === key ? { ...i, read: true } : i));
    });
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, status }),
      });
    } catch {
      void load();
    } finally {
      setBusyKey(null);
    }
  }

  async function markAllRead() {
    const visible = (items ?? []).filter((i) => i.kind === currentKind && !i.read);
    if (visible.length === 0) return;
    const keys = visible.map((i) => i.id);
    setItems((prev) =>
      prev ? prev.map((i) => (keys.includes(i.id) ? { ...i, read: true } : i)) : prev,
    );
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true, status: "read", keys }),
      });
    } catch {
      void load();
    }
  }

  const currentKind = tab === "alarms" ? "alarm" : "message";
  const all = items ?? [];
  const alarms = all.filter((i) => i.kind === "alarm");
  const messages = all.filter((i) => i.kind === "message");
  const list = tab === "alarms" ? alarms : messages;
  const unreadAlarms = alarms.filter((i) => !i.read).length;
  const unreadMessages = messages.filter((i) => !i.read).length;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-magic-border bg-white/80 backdrop-blur-sm shadow-mt-soft">
      <div className="flex items-center gap-1 border-b border-magic-border/70 p-2">
        <TabButton
          active={tab === "alarms"}
          onClick={() => setTab("alarms")}
          icon={<Bell className="h-3.5 w-3.5" />}
          label="Alarms"
          badge={unreadAlarms}
        />
        <TabButton
          active={tab === "messages"}
          onClick={() => setTab("messages")}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="Messages"
          badge={unreadMessages}
        />
        <button
          onClick={() => void markAllRead()}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-magic-ink/55 hover:bg-magic-soft hover:text-magic-ink transition-colors"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Mark all read
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items === null ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner size={18} label="Loading…" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-magic-ink/60">
              {tab === "alarms" ? "No active alarms." : "No messages."}
            </p>
            <p className="mt-0.5 text-xs text-magic-ink/40">You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {list.map((n) => (
              <li
                key={n.id}
                className={`group rounded-xl border p-3 transition-colors ${
                  n.read
                    ? "border-magic-border/50 bg-magic-soft/30 opacity-70"
                    : "border-magic-border bg-white hover:border-magic-red/30"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[n.severity]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-snug text-magic-ink">
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 text-[11px] leading-snug text-magic-ink/60">
                        {n.body}
                      </p>
                    )}
                    {n.action && (
                      <Link
                        href={n.action.href}
                        className="mt-1.5 inline-flex items-center text-[11px] font-semibold text-magic-red hover:underline"
                      >
                        {n.action.label} →
                      </Link>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!n.read && (
                      <button
                        onClick={() => void setState(n.id, "read")}
                        disabled={busyKey === n.id}
                        aria-label="Mark as read"
                        title="Mark as read"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-magic-ink/40 hover:bg-magic-soft hover:text-emerald-600 transition-colors"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => void setState(n.id, "removed")}
                      disabled={busyKey === n.id}
                      aria-label="Remove"
                      title="Remove"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-magic-ink/40 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-magic-red/10 text-magic-red"
          : "text-magic-ink/60 hover:bg-magic-soft hover:text-magic-ink"
      }`}
    >
      {icon}
      {label}
      {badge > 0 && (
        <span className="inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-magic-red px-1 text-[9px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
