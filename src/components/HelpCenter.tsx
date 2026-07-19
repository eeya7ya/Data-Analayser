"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Search,
  ChevronDown,
  HelpCircle,
  LifeBuoy,
  Compass,
  NotebookPen,
  Briefcase,
  ClipboardList,
  BadgeCheck,
  Tags,
  FolderKanban,
  Boxes,
  Truck,
  ShieldCheck,
  BookOpen,
  type LucideIcon,
} from "@/lib/icons";
import type { SessionUser } from "@/lib/auth";
import { canReadAll } from "@/lib/authShared";
import { docsForUser, type Grant, type HelpDoc } from "@/lib/help/content";

interface ModuleRole {
  module: string;
  role: string;
}

const ICONS: Record<string, LucideIcon> = {
  Compass,
  NotebookPen,
  Briefcase,
  ClipboardList,
  BadgeCheck,
  Tags,
  FolderKanban,
  Boxes,
  Truck,
  ShieldCheck,
  BookOpen,
};

// tone key → the chip colour for the doc's icon.
const TONES: Record<string, string> = {
  red: "bg-magic-red/10 text-magic-red",
  accent: "bg-indigo-100 text-indigo-600",
  indigo: "bg-indigo-100 text-indigo-600",
  cyan: "bg-cyan-100 text-cyan-600",
  rose: "bg-rose-100 text-rose-600",
  emerald: "bg-emerald-100 text-emerald-600",
  violet: "bg-violet-100 text-violet-600",
  amber: "bg-amber-100 text-amber-600",
  ink: "bg-magic-ink/10 text-magic-ink",
};

/** Flatten a doc's text so the search box can match section content too. */
function docText(doc: HelpDoc): string {
  const parts = [doc.title, doc.intro];
  for (const s of doc.sections) {
    parts.push(s.heading, s.body, ...(s.steps ?? []));
  }
  return parts.join(" ").toLowerCase();
}

/**
 * The Help Center — a right-hand drawer that mirrors the SideNav's slide
 * motion (so the app's "moving UI" feels consistent) but opens from the
 * opposite side to stay distinct from navigation. It shows the walk-through
 * documentation, filtered to the signed-in user's role: a salesperson reads
 * Sales, a technician reads Projects, an admin reads everything. A search box
 * narrows across every visible doc.
 */
export default function HelpCenter({
  open,
  onClose,
  user,
  moduleRoles,
}: {
  open: boolean;
  onClose: () => void;
  user: SessionUser;
  moduleRoles: ModuleRole[] | null;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAdmin = canReadAll(user);
  const grants: Grant[] = moduleRoles ?? [];

  const docs = useMemo(
    () => docsForUser({ isAdmin, grants }),
    // grants identity changes when moduleRoles changes; stringify to keep the
    // memo honest without depending on a fresh array reference each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, JSON.stringify(grants)],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return docs;
    return docs.filter((d) => docText(d).includes(q));
  }, [docs, query]);

  // Open the first doc by default so the panel is never a wall of collapsed
  // rows; re-anchor it whenever the visible set changes.
  useEffect(() => {
    if (!open) return;
    setExpanded((cur) => {
      if (cur && filtered.some((d) => d.id === cur)) return cur;
      return filtered[0]?.id ?? null;
    });
  }, [open, filtered]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — plain dim layer (no blur, matching the SideNav). */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-50 bg-magic-ink/40 transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        role="dialog"
        aria-label="Help center"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-96 max-w-[92vw] flex-col border-l border-magic-border/60 bg-white shadow-2xl transition-transform duration-200 ease-out will-change-transform ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-magic-border/60 px-4 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-magic-red/15 to-magic-accent/15 text-magic-red">
              <LifeBuoy className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight text-magic-ink">
                Help center
              </p>
              <p className="truncate text-[11px] text-magic-ink/50">
                Guides for your role
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-magic-ink/60 hover:bg-magic-soft hover:text-magic-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 rounded-xl border border-magic-border bg-magic-soft/60 px-3 py-2 focus-within:border-magic-red/40 focus-within:bg-white">
            <Search className="h-4 w-4 shrink-0 text-magic-ink/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help…"
              className="w-full bg-transparent text-sm text-magic-ink placeholder:text-magic-ink/40 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-magic-ink/40 hover:text-magic-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Docs */}
        <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-6">
          {filtered.length === 0 && (
            <p className="mt-6 text-center text-sm text-magic-ink/50">
              No help topics match “{query}”.
            </p>
          )}
          {filtered.map((doc) => {
            const Icon = ICONS[doc.icon] ?? BookOpen;
            const tone = TONES[doc.tone] ?? TONES.ink;
            const isOpen = expanded === doc.id;
            return (
              <div
                key={doc.id}
                className="overflow-hidden rounded-2xl border border-magic-border bg-white shadow-mt-soft"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : doc.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-magic-soft/50"
                >
                  <span
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-magic-ink">
                      {doc.title}
                    </span>
                    <span className="block truncate text-[11px] text-magic-ink/50">
                      {doc.intro}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-magic-ink/40 transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="space-y-4 border-t border-magic-border/60 px-4 py-4">
                    {doc.sections.map((s, i) => (
                      <div key={i}>
                        <h5 className="text-[13px] font-bold text-magic-ink">
                          {s.heading}
                        </h5>
                        <p className="mt-1 text-[13px] leading-relaxed text-magic-ink/70">
                          {s.body}
                        </p>
                        {s.steps && s.steps.length > 0 && (
                          <ol className="mt-2 space-y-1.5">
                            {s.steps.map((step, j) => (
                              <li
                                key={j}
                                className="flex gap-2 text-[13px] leading-relaxed text-magic-ink/70"
                              >
                                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-magic-red/10 text-[10px] font-bold text-magic-red">
                                  {j + 1}
                                </span>
                                <span className="min-w-0">{step}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="border-t border-magic-border/60 bg-magic-soft/40 px-4 py-3">
          <p className="inline-flex flex-wrap items-center gap-1 text-[11px] leading-relaxed text-magic-ink/50">
            Look for the
            <HelpCircle className="h-3.5 w-3.5 text-magic-ink/70" />
            markers around the app for a quick explanation of any area.
          </p>
        </div>
      </aside>
    </>
  );
}
