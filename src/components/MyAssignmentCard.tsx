"use client";

import { useEffect, useState } from "react";
import { MapPin, CalendarDays, StickyNote, UserCheck } from "@/lib/icons";

/**
 * A prominent "Your assignment" callout for the person executing a
 * project. It pulls the roster, finds the current user's own row(s), and
 * surfaces the location / dates / notes the project manager entered when
 * assigning them — so a technician doesn't have to hunt through the full
 * team roster to find their brief. Renders nothing if the viewer isn't
 * assigned to this project.
 */

interface Assignment {
  id: number;
  user_id: number;
  role: "technical" | "engineer" | "manager";
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  assigned_by_username: string | null;
}

const ROLE_LABEL: Record<string, string> = {
  technical: "Technician",
  engineer: "Engineer",
  manager: "Project Manager",
};

export default function MyAssignmentCard({ projectId }: { projectId: number }) {
  const [mine, setMine] = useState<Assignment[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/project-assignments?project_id=${projectId}`, {
        cache: "no-store",
      }).then((r) => r.json()),
      fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([aData, meData]) => {
        if (cancelled) return;
        const meId = Number(meData?.user?.id);
        const all: Assignment[] = aData?.assignments ?? [];
        setMine(all.filter((a) => a.user_id === meId));
      })
      .catch(() => {
        if (!cancelled) setMine([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (mine.length === 0) return null;

  return (
    <section className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-5">
      <div className="mb-3 flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-cyan-700" />
        <h2 className="text-lg font-semibold text-magic-ink">Your assignment</h2>
      </div>
      <div className="space-y-3">
        {mine.map((a) => (
          <div
            key={a.id}
            className="rounded-xl border border-cyan-200 bg-white p-4"
          >
            <span className="inline-flex items-center rounded-full border border-cyan-300 bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-800">
              {ROLE_LABEL[a.role] ?? a.role}
            </span>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Field
                icon={<MapPin className="h-4 w-4 text-cyan-600" />}
                label="Location"
                value={a.location}
                map
              />
              <Field
                icon={<CalendarDays className="h-4 w-4 text-cyan-600" />}
                label="Schedule"
                value={
                  a.start_date || a.end_date
                    ? `${a.start_date ?? "—"} → ${a.end_date ?? "—"}`
                    : null
                }
              />
              <div className="sm:col-span-2">
                <Field
                  icon={<StickyNote className="h-4 w-4 text-cyan-600" />}
                  label="Notes from the project manager"
                  value={a.notes}
                />
              </div>
            </dl>
            {a.assigned_by_username && (
              <p className="mt-2 text-[11px] text-magic-ink/45">
                Assigned by {a.assigned_by_username}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({
  icon,
  label,
  value,
  map = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  map?: boolean;
}) {
  const mapsHref =
    map && value
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`
      : null;
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-magic-ink/50">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-magic-ink">
        {value ? (
          mapsHref ? (
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-cyan-700 hover:underline"
            >
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-magic-ink/35">—</span>
        )}
      </dd>
    </div>
  );
}
