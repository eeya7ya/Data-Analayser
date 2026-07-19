"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, AlertTriangle, Inbox } from "@/lib/icons";

/**
 * Project-manager day scheduler. A week grid of technicians (rows) × days
 * (columns); each cell holds the assignment cards scheduled for that person
 * on that day. The PM drags cards between cells to reschedule (change the
 * day) and/or reassign (change the technician) in one move, and drags into
 * the "Unscheduled" tray to clear a date. A technician with more than one
 * job on a day is flagged so double-bookings are obvious.
 *
 * Drag-and-drop uses the native HTML5 API — no extra dependency. Each move
 * applies optimistically, then PATCHes /api/project-assignments and refetches
 * to reconcile (reverting on error).
 */

interface Assignment {
  id: number;
  project_id: number;
  project_name: string;
  client_name: string | null;
  status: string;
  user_id: number;
  role: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  notes: string | null;
}

interface Technician {
  id: number;
  username: string;
  display_name: string | null;
  roles: string[];
}

interface ScheduleData {
  technicians: Technician[];
  scheduled: Assignment[];
  unscheduled: Assignment[];
  error?: string;
}

const ROLE_TONE: Record<string, string> = {
  technical: "border-l-sky-400",
  engineer: "border-l-violet-400",
  manager: "border-l-amber-400",
};

export default function ScheduleBoard() {
  const [weekStart, setWeekStart] = useState<string>(() =>
    isoDate(startOfWeek(new Date())),
  );
  const [data, setData] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const days = useMemo(() => {
    const start = fromIso(weekStart);
    return Array.from({ length: 7 }, (_, i) => isoDate(addDays(start, i)));
  }, [weekStart]);
  const from = days[0];
  const to = days[6];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/project-assignments/schedule?from=${from}&to=${to}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as ScheduleData;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Apply a move: schedule/reassign onto (userId, dayIso) or, when dayIso is
   * null, send back to the unscheduled tray. Optimistic, then PATCH + reload. */
  async function move(id: number, userId: number | null, dayIso: string | null) {
    if (!data) return;
    const all = [...data.scheduled, ...data.unscheduled];
    const a = all.find((x) => x.id === id);
    if (!a) return;
    // No-op guard.
    const targetUser = userId ?? a.user_id;
    if (
      (a.start_date ?? null) === dayIso &&
      a.user_id === targetUser
    ) {
      return;
    }

    const updated: Assignment = {
      ...a,
      user_id: targetUser,
      start_date: dayIso,
      end_date: dayIso,
    };
    const nextScheduled = data.scheduled.filter((x) => x.id !== id);
    const nextUnscheduled = data.unscheduled.filter((x) => x.id !== id);
    if (dayIso) nextScheduled.push(updated);
    else nextUnscheduled.push(updated);
    setData({ ...data, scheduled: nextScheduled, unscheduled: nextUnscheduled });

    try {
      const res = await fetch("/api/project-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          start_date: dayIso,
          end_date: dayIso,
          ...(userId !== null ? { user_id: userId } : {}),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      void load();
    } catch (err) {
      setError((err as Error).message);
      void load(); // reconcile / revert
    }
  }

  function onDrop(userId: number | null, dayIso: string | null) {
    if (dragId !== null) void move(dragId, userId, dayIso);
    setDragId(null);
  }

  const techs = data?.technicians ?? [];
  const scheduled = data?.scheduled ?? [];
  const unscheduled = data?.unscheduled ?? [];

  // Index scheduled assignments by `${userId}|${dayIso}` for O(1) cell lookups.
  const byCell = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of scheduled) {
      if (!a.start_date) continue;
      const key = `${a.user_id}|${a.start_date.slice(0, 10)}`;
      const arr = m.get(key);
      if (arr) arr.push(a);
      else m.set(key, [a]);
    }
    return m;
  }, [scheduled]);

  const todayIso = isoDate(new Date());

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWeekStart(isoDate(addDays(fromIso(weekStart), -7)))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(isoDate(startOfWeek(new Date())))}
            className="rounded-lg border border-magic-border bg-white px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
          >
            This week
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(isoDate(addDays(fromIso(weekStart), 7)))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-magic-border bg-white text-magic-ink/70 hover:bg-magic-soft"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-2 text-sm font-semibold text-magic-ink">
            {fmtRange(from, to)}
          </span>
        </div>
        {loading && <span className="text-xs text-magic-ink/40">Loading…</span>}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {/* Unscheduled tray — drop here to clear a date */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => onDrop(null, null)}
        className="rounded-xl border border-dashed border-magic-border bg-magic-soft/30 p-3"
      >
        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-magic-ink/40">
          <Inbox className="h-3.5 w-3.5" /> Unscheduled ({unscheduled.length})
        </div>
        {unscheduled.length === 0 ? (
          <p className="text-xs text-magic-ink/40">
            Nothing waiting. Assignments without a day land here — drag them
            onto a technician and day.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((a) => (
              <Card key={a.id} a={a} onDragStart={() => setDragId(a.id)} compact />
            ))}
          </div>
        )}
      </div>

      {/* Tech × day grid */}
      <div className="overflow-x-auto rounded-2xl border border-magic-border bg-white">
        <div className="min-w-[900px]">
          {/* Header */}
          <div className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-magic-border bg-magic-soft/40 text-xs font-semibold text-magic-ink/60">
            <div className="px-3 py-2">Technician</div>
            {days.map((d) => (
              <div
                key={d}
                className={`px-2 py-2 text-center ${
                  d === todayIso ? "bg-magic-red/5 text-magic-red" : ""
                }`}
              >
                {fmtDay(d)}
              </div>
            ))}
          </div>

          {techs.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-magic-ink/40">
              No technicians yet. Grant users a projects-module role
              (technical / engineer / manager) in Admin → Modules.
            </p>
          ) : (
            techs.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-[180px_repeat(7,1fr)] border-b border-magic-border/60 last:border-0"
              >
                <div className="px-3 py-2">
                  <div className="truncate text-sm font-semibold text-magic-ink">
                    {t.display_name || t.username}
                  </div>
                  <div className="truncate text-[11px] text-magic-ink/45">
                    {t.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")}
                  </div>
                </div>
                {days.map((d) => {
                  const cell = byCell.get(`${t.id}|${d}`) ?? [];
                  const overbooked = cell.length > 1;
                  return (
                    <div
                      key={d}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(t.id, d)}
                      className={`min-h-[64px] border-l border-magic-border/40 p-1 ${
                        d === todayIso ? "bg-magic-red/[0.03]" : ""
                      } ${overbooked ? "ring-1 ring-inset ring-amber-300" : ""}`}
                    >
                      {overbooked && (
                        <div className="mb-1 flex items-center gap-0.5 text-[10px] font-bold text-amber-600">
                          <AlertTriangle className="h-3 w-3" />
                          {cell.length} jobs
                        </div>
                      )}
                      <div className="space-y-1">
                        {cell.map((a) => (
                          <Card
                            key={a.id}
                            a={a}
                            onDragStart={() => setDragId(a.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      <p className="text-xs text-magic-ink/40">
        Drag a card to another day or technician to reschedule. Drag it to the
        Unscheduled tray to clear its date. Assignments are created on a
        project&apos;s page; this board arranges them.
      </p>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  technical: "Technician",
  engineer: "Engineer",
  manager: "Project Manager",
};

function Card({
  a,
  onDragStart,
  compact,
}: {
  a: Assignment;
  onDragStart: () => void;
  compact?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(a.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      className={`cursor-grab rounded-md border border-magic-border border-l-[3px] bg-white px-2 py-1 text-xs shadow-sm active:cursor-grabbing ${
        ROLE_TONE[a.role] ?? "border-l-gray-300"
      } ${compact ? "w-44" : ""}`}
      title={`${a.project_name}${a.client_name ? ` · ${a.client_name}` : ""} · ${ROLE_LABEL[a.role] ?? a.role}`}
    >
      <Link
        href={`/projects/${a.project_id}`}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
        className="block truncate font-semibold text-magic-ink hover:text-magic-red"
      >
        {a.project_name}
      </Link>
      <div className="truncate text-[10px] text-magic-ink/45">
        {a.client_name ? `${a.client_name} · ` : ""}
        {ROLE_LABEL[a.role] ?? a.role}
      </div>
    </div>
  );
}

// ── date helpers (all local-calendar, formatted as YYYY-MM-DD) ──────────────

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtDay(iso: string): string {
  const d = fromIso(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}
function fmtRange(fromIsoStr: string, toIsoStr: string): string {
  const a = fromIso(fromIsoStr);
  const b = fromIso(toIsoStr);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${a.toLocaleDateString(undefined, opts)} – ${b.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
}
