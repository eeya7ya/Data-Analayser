"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";

/**
 * Calendar Marker — a per-user week calendar. One page == one week and the
 * grid fills the viewport. Click any day to jot a short note and tag it
 * with a colour; marks persist via /api/calendar (scoped to the signed-in
 * user). Navigation moves a week at a time, with a quick jump back to the
 * current week.
 */

interface Mark {
  note: string;
  color: ColorKey;
}

type ColorKey = "red" | "amber" | "emerald" | "sky" | "violet" | "slate";

const COLORS: Record<
  ColorKey,
  { label: string; dot: string; cell: string; bar: string; swatch: string }
> = {
  red: {
    label: "Red",
    dot: "bg-magic-red",
    cell: "bg-magic-red/5 border-magic-red/30",
    bar: "bg-magic-red",
    swatch: "bg-magic-red",
  },
  amber: {
    label: "Amber",
    dot: "bg-amber-500",
    cell: "bg-amber-50 border-amber-300",
    bar: "bg-amber-500",
    swatch: "bg-amber-500",
  },
  emerald: {
    label: "Green",
    dot: "bg-emerald-500",
    cell: "bg-emerald-50 border-emerald-300",
    bar: "bg-emerald-500",
    swatch: "bg-emerald-500",
  },
  sky: {
    label: "Blue",
    dot: "bg-sky-500",
    cell: "bg-sky-50 border-sky-300",
    bar: "bg-sky-500",
    swatch: "bg-sky-500",
  },
  violet: {
    label: "Violet",
    dot: "bg-violet-500",
    cell: "bg-violet-50 border-violet-300",
    bar: "bg-violet-500",
    swatch: "bg-violet-500",
  },
  slate: {
    label: "Grey",
    dot: "bg-slate-400",
    cell: "bg-slate-50 border-slate-300",
    bar: "bg-slate-400",
    swatch: "bg-slate-400",
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
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-magic-red/10 text-magic-red">
            <CalendarDays className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
              Calendar Marker
            </h1>
            <p className="text-sm text-magic-ink/55">
              {rangeLabel}
              {markedCount > 0 && (
                <span className="ml-2 text-magic-ink/40">
                  · {markedCount} marked
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Previous week"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-magic-border bg-white text-magic-ink/70 shadow-sm transition-colors hover:bg-magic-soft hover:text-magic-ink"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded-xl border border-magic-border bg-white px-3.5 py-2 text-sm font-semibold text-magic-ink/80 shadow-sm transition-colors hover:bg-magic-soft"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Next week"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-magic-border bg-white text-magic-ink/70 shadow-sm transition-colors hover:bg-magic-soft hover:text-magic-ink"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Week grid — fills the remaining height */}
      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
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
              className={`group relative flex min-h-[8rem] flex-col overflow-hidden rounded-2xl border p-3 text-left shadow-mt-soft transition-all hover:shadow-mt-lift lg:min-h-0 ${
                c
                  ? c.cell
                  : isWeekend
                    ? "border-magic-border bg-magic-soft/50"
                    : "border-magic-border bg-white/80"
              }`}
            >
              {c && (
                <span
                  className={`absolute inset-y-0 left-0 w-1.5 ${c.bar}`}
                  aria-hidden
                />
              )}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-magic-ink/45">
                  {WEEKDAYS[d.getDay()]}
                </span>
                <span
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-bold ${
                    isToday
                      ? "bg-magic-red text-white shadow-sm"
                      : "text-magic-ink/80"
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>

              <div className="mt-2 flex-1">
                {mark ? (
                  <p className="whitespace-pre-line break-words text-sm leading-snug text-magic-ink/85 line-clamp-6">
                    {mark.note}
                  </p>
                ) : (
                  <span className="text-xs text-magic-ink/30 opacity-0 transition-opacity group-hover:opacity-100">
                    + Add a note
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {loading && (
        <p className="mt-3 text-center text-xs text-magic-ink/40">Syncing…</p>
      )}

      {editing && (
        <DayEditor
          dateKey={editing}
          initial={marks[editing]}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={(d) => void save(d, "", "red")}
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
  const [color, setColor] = useState<ColorKey>(initial?.color ?? "red");
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-magic-border bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-magic-ink">{pretty}</h2>
            <p className="text-xs text-magic-ink/50">Mark this day.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-magic-ink/50 hover:bg-magic-soft hover:text-magic-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's happening this day?"
          className="w-full resize-none rounded-xl border border-magic-border bg-white px-3 py-2.5 text-sm text-magic-ink focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
        />

        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs font-semibold text-magic-ink/55">Colour</span>
          <div className="flex items-center gap-1.5">
            {(Object.keys(COLORS) as ColorKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setColor(k)}
                aria-label={COLORS[k].label}
                className={`h-6 w-6 rounded-full ${COLORS[k].swatch} transition-transform hover:scale-110 ${
                  color === k
                    ? "ring-2 ring-magic-ink/60 ring-offset-2"
                    : "ring-1 ring-black/5"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          {initial ? (
            <button
              onClick={() => onDelete(dateKey)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-magic-red hover:bg-magic-red/5"
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
              className="rounded-lg border border-magic-border bg-white px-3.5 py-2 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(dateKey, note, color)}
              className="rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
