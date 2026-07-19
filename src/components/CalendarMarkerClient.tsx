"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarHeart,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
} from "@/lib/icons";

/**
 * Calendar Marker — a per-user week calendar designed to feel soft and
 * calm. One page == one week and the grid fills the viewport. Click any
 * day to jot a short note and tag it with a pastel colour; marks persist
 * via /api/calendar (scoped to the signed-in user).
 */

interface Mark {
  note: string;
  color: ColorKey;
}

type ColorKey = "rose" | "amber" | "emerald" | "sky" | "violet" | "slate";

const COLORS: Record<
  ColorKey,
  {
    label: string;
    dot: string;
    grad: string;
    border: string;
    bar: string;
    swatch: string;
    text: string;
  }
> = {
  rose: {
    label: "Blossom",
    dot: "bg-rose-400",
    grad: "from-rose-50 to-pink-50/40",
    border: "border-rose-200",
    bar: "bg-rose-300",
    swatch: "bg-rose-400",
    text: "text-rose-900/80",
  },
  amber: {
    label: "Honey",
    dot: "bg-amber-400",
    grad: "from-amber-50 to-orange-50/40",
    border: "border-amber-200",
    bar: "bg-amber-300",
    swatch: "bg-amber-400",
    text: "text-amber-900/80",
  },
  emerald: {
    label: "Mint",
    dot: "bg-emerald-400",
    grad: "from-emerald-50 to-teal-50/40",
    border: "border-emerald-200",
    bar: "bg-emerald-300",
    swatch: "bg-emerald-400",
    text: "text-emerald-900/80",
  },
  sky: {
    label: "Sky",
    dot: "bg-sky-400",
    grad: "from-sky-50 to-cyan-50/40",
    border: "border-sky-200",
    bar: "bg-sky-300",
    swatch: "bg-sky-400",
    text: "text-sky-900/80",
  },
  violet: {
    label: "Lavender",
    dot: "bg-violet-400",
    grad: "from-violet-50 to-purple-50/40",
    border: "border-violet-200",
    bar: "bg-violet-300",
    swatch: "bg-violet-400",
    text: "text-violet-900/80",
  },
  slate: {
    label: "Cloud",
    dot: "bg-slate-400",
    grad: "from-slate-50 to-slate-100/40",
    border: "border-slate-200",
    bar: "bg-slate-300",
    swatch: "bg-slate-400",
    text: "text-slate-700",
  },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local YYYY-MM-DD (no UTC shift). */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export default function CalendarMarkerClient() {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const todayKey = ymd(new Date());

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const from = ymd(weekStart);
    const to = ymd(addDays(weekStart, 6));
    try {
      const res = await fetch(`/api/calendar?from=${from}&to=${to}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        marks?: Array<{ mark_date: string; note: string; color: ColorKey }>;
      };
      const next: Record<string, Mark> = {};
      for (const m of data.marks ?? []) {
        next[m.mark_date] = { note: m.note, color: m.color };
      }
      setMarks(next);
    } catch {
      setMarks({});
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(date: string, note: string, color: ColorKey) {
    const trimmed = note.trim();
    setMarks((prev) => {
      const next = { ...prev };
      if (!trimmed) delete next[date];
      else next[date] = { note: trimmed, color };
      return next;
    });
    setEditing(null);
    try {
      await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, note: trimmed, color }),
      });
    } catch {
      void load(); // re-sync on failure
    }
  }

  const rangeLabel = useMemo(() => {
    const a = weekStart;
    const b = addDays(weekStart, 6);
    const left = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
    const right =
      a.getMonth() === b.getMonth()
        ? `${b.getDate()}, ${b.getFullYear()}`
        : `${MONTHS[b.getMonth()]} ${b.getDate()}, ${b.getFullYear()}`;
    return `${left} – ${right}`;
  }, [weekStart]);

  const markedCount = Object.keys(marks).length;

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Soft decorative glow so the page never feels like a blank sheet. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-rose-200/30 via-violet-200/30 to-sky-200/30 blur-3xl"
      />

      {/* Header */}
      <div className="relative mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-400 to-magic-red text-white shadow-lg shadow-rose-300/40">
            <CalendarHeart className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
              Calendar Marker
            </h1>
            <p className="text-sm text-magic-ink/55">
              {rangeLabel}
              {markedCount > 0 && (
                <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                  {markedCount} marked
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-2xl border border-white bg-white/70 p-1 shadow-sm backdrop-blur">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Previous week"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-magic-ink/60 transition-colors hover:bg-rose-50 hover:text-magic-red"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded-xl px-3.5 py-1.5 text-sm font-semibold text-magic-ink/75 transition-colors hover:bg-rose-50 hover:text-magic-red"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Next week"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-magic-ink/60 transition-colors hover:bg-rose-50 hover:text-magic-red"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Week grid — 4 cards on top, 3 on the bottom, filling the screen */}
      <div className="relative grid flex-1 grid-cols-2 gap-3 sm:grid-cols-2 lg:auto-rows-fr lg:grid-cols-4 lg:grid-rows-2">
        {days.map((d) => {
          const key = ymd(d);
          const mark = marks[key];
          const isToday = key === todayKey;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const c = mark ? COLORS[mark.color] : null;
          return (
            <button
              key={key}
              onClick={() => setEditing(key)}
              className={`group relative flex min-h-[9rem] flex-col overflow-hidden rounded-[1.75rem] border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-rose-200/40 lg:min-h-0 ${
                c
                  ? `bg-gradient-to-br ${c.grad} ${c.border} shadow-md shadow-rose-100/40`
                  : isToday
                    ? "border-rose-200 bg-gradient-to-br from-rose-50 to-white shadow-md shadow-rose-200/40 ring-2 ring-rose-300/50"
                    : isWeekend
                      ? "border-violet-100 bg-gradient-to-br from-violet-50/50 to-white shadow-sm"
                      : "border-white bg-gradient-to-br from-white to-slate-50/60 shadow-sm"
              }`}
            >
              {c && (
                <span
                  className={`absolute inset-y-3 left-0 w-1.5 rounded-full ${c.bar}`}
                  aria-hidden
                />
              )}
              <div className="flex items-center justify-between">
                <span
                  className={`text-[11px] font-bold uppercase tracking-widest ${
                    isToday ? "text-magic-red/70" : "text-magic-ink/40"
                  }`}
                >
                  {WEEKDAYS[d.getDay()]}
                </span>
                <span
                  className={`inline-flex h-8 min-w-8 items-center justify-center rounded-2xl px-2 text-sm font-bold transition-colors ${
                    isToday
                      ? "bg-gradient-to-br from-rose-400 to-magic-red text-white shadow-md shadow-rose-300/50"
                      : "bg-white/70 text-magic-ink/75"
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>

              <div className="mt-2.5 flex flex-1 flex-col">
                {mark ? (
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${c!.dot}`}
                      aria-hidden
                    />
                    <p
                      className={`whitespace-pre-line break-words text-sm font-medium leading-snug ${c!.text} line-clamp-6`}
                    >
                      {mark.note}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 text-magic-ink/30">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-magic-ink/20 bg-white/60 transition-colors group-hover:border-magic-red/40 group-hover:bg-rose-50 group-hover:text-magic-red">
                      <Plus className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] font-medium opacity-60 transition-opacity group-hover:opacity-100">
                      Add a note
                    </span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {loading && (
        <p className="relative mt-3 text-center text-xs text-magic-ink/40">
          Syncing…
        </p>
      )}

      {editing && (
        <DayEditor
          dateKey={editing}
          initial={marks[editing]}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={(d) => void save(d, "", "rose")}
        />
      )}
    </div>
  );
}

function DayEditor({
  dateKey,
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  dateKey: string;
  initial?: Mark;
  onClose: () => void;
  onSave: (date: string, note: string, color: ColorKey) => void;
  onDelete: (date: string) => void;
}) {
  const [note, setNote] = useState(initial?.note ?? "");
  const [color, setColor] = useState<ColorKey>(initial?.color ?? "rose");
  const [y, m, d] = dateKey.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const pretty = `${WEEKDAYS[dateObj.getDay()]}, ${MONTHS[dateObj.getMonth()]} ${d}, ${y}`;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[1.75rem] border border-white bg-white/95 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-magic-ink">{pretty}</h2>
            <p className="text-xs text-magic-ink/50">A little note for this day.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-magic-ink/50 hover:bg-rose-50 hover:text-magic-red"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's happening this day? ✿"
          className="w-full resize-none rounded-2xl border border-magic-border bg-rose-50/30 px-4 py-3 text-sm text-magic-ink placeholder:text-magic-ink/35 focus:border-rose-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-200"
        />

        <div className="mt-4 flex items-center gap-2.5">
          <span className="text-xs font-semibold text-magic-ink/55">Colour</span>
          <div className="flex items-center gap-2">
            {(Object.keys(COLORS) as ColorKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setColor(k)}
                title={COLORS[k].label}
                aria-label={COLORS[k].label}
                className={`h-7 w-7 rounded-full ${COLORS[k].swatch} transition-transform hover:scale-110 ${
                  color === k
                    ? "scale-110 ring-2 ring-magic-ink/40 ring-offset-2"
                    : "ring-1 ring-black/5"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          {initial ? (
            <button
              onClick={() => onDelete(dateKey)}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-magic-red hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-magic-border bg-white px-4 py-2 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(dateKey, note, color)}
              className="rounded-xl bg-gradient-to-br from-rose-400 to-magic-red px-5 py-2 text-sm font-semibold text-white shadow-md shadow-rose-300/40 transition-transform hover:scale-105"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
