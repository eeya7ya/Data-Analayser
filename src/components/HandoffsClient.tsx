"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Phone, User, ClipboardList } from "lucide-react";
import Spinner from "@/components/Spinner";

interface Handoff {
  id: number;
  quotation_id: number | null;
  project_id: number | null;
  status: "pending_assignment" | "assigned" | "completed" | "cancelled";
  contact_name: string | null;
  contact_phones: string | null;
  site_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  priority: "low" | "normal" | "high" | "urgent";
  notes: string | null;
  boq_items: number;
  quotation_ref: string | null;
  project_name: string | null;
  folder_name: string | null;
  created_by_display_name: string | null;
  created_by_username: string | null;
  assigned_display_name: string | null;
  assigned_username: string | null;
  assigned_at: string | null;
  created_at: string;
}

interface AssignUser {
  id: number;
  username: string;
  display_name: string | null;
}

const PRIORITY_STYLE: Record<Handoff["priority"], string> = {
  urgent: "bg-magic-red/10 text-magic-red border-magic-red/30",
  high: "bg-amber-50 text-amber-800 border-amber-300",
  normal: "bg-magic-soft text-magic-ink/60 border-magic-border",
  low: "bg-magic-soft text-magic-ink/45 border-magic-border",
};

const STATUS_STYLE: Record<Handoff["status"], string> = {
  pending_assignment: "bg-amber-50 text-amber-800",
  assigned: "bg-blue-50 text-blue-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-magic-soft text-magic-ink/50",
};

const STATUS_LABEL: Record<Handoff["status"], string> = {
  pending_assignment: "Awaiting member",
  assigned: "Assigned",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function HandoffsClient() {
  const [handoffs, setHandoffs] = useState<Handoff[] | null>(null);
  const [canAssign, setCanAssign] = useState(false);
  const [users, setUsers] = useState<AssignUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/project-handoffs", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { handoffs?: Handoff[]; can_assign?: boolean };
      setHandoffs(Array.isArray(data.handoffs) ? data.handoffs : []);
      setCanAssign(!!data.can_assign);
      if (data.can_assign) {
        const ur = await fetch("/api/leads/users?role=projects", { cache: "no-store" });
        if (ur.ok) {
          const ud = (await ur.json()) as { users?: AssignUser[] };
          setUsers(Array.isArray(ud.users) ? ud.users : []);
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setHandoffs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (handoffs === null) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Spinner size={20} label="Loading handoffs…" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {handoffs.length === 0 ? (
        <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
          <p className="text-sm text-magic-ink/60">No project handoffs yet.</p>
          <p className="mt-0.5 text-xs text-magic-ink/40">
            Sales convert approved quotations here; they&apos;ll appear for assignment.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {handoffs.map((h) => (
            <HandoffCard
              key={h.id}
              h={h}
              canAssign={canAssign && h.status !== "completed" && h.status !== "cancelled"}
              users={users}
              onAssigned={() => void load()}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function HandoffCard({
  h,
  canAssign,
  users,
  onAssigned,
  onError,
}: {
  h: Handoff;
  canAssign: boolean;
  users: AssignUser[];
  onAssigned: () => void;
  onError: (m: string) => void;
}) {
  const [assignee, setAssignee] = useState<string>("");
  const [role, setRole] = useState<string>("engineer");
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!assignee) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/project-handoffs/${h.id}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assigned_user_id: Number(assignee), role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onAssigned();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const creator = h.created_by_display_name || h.created_by_username || "—";
  const assigned = h.assigned_display_name || h.assigned_username;

  return (
    <li className="rounded-2xl border border-magic-border bg-white p-4 shadow-mt-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-magic-ink">
              {h.project_name || h.quotation_ref || `Handoff #${h.id}`}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLE[h.priority]}`}>
              {h.priority}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[h.status]}`}>
              {STATUS_LABEL[h.status]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-magic-ink/55">
            {h.quotation_ref && <>Quotation {h.quotation_ref} · </>}
            {h.folder_name && <>{h.folder_name} · </>}
            by {creator}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-magic-soft px-2 py-0.5 text-[11px] font-semibold text-magic-ink/60">
          <ClipboardList className="h-3.5 w-3.5" />
          {h.boq_items} BOQ line{h.boq_items === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-magic-ink/70 sm:grid-cols-2">
        {(h.contact_name || h.contact_phones) && (
          <div className="flex items-start gap-1.5">
            <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-magic-ink/40" />
            <span>
              {h.contact_name}
              {h.contact_phones && (
                <span className="flex items-center gap-1 text-magic-ink/55">
                  <Phone className="h-3 w-3" /> {h.contact_phones}
                </span>
              )}
            </span>
          </div>
        )}
        {(h.site_address || (h.location_lat != null && h.location_lng != null)) && (
          <div className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-magic-ink/40" />
            <span>
              {h.site_address}
              {h.location_lat != null && h.location_lng != null && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${h.location_lat}&mlon=${h.location_lng}#map=17/${h.location_lat}/${h.location_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block font-semibold text-magic-red hover:underline"
                >
                  Open map ({h.location_lat.toFixed(4)}, {h.location_lng.toFixed(4)})
                </a>
              )}
            </span>
          </div>
        )}
      </div>

      {h.notes && (
        <p className="mt-2 rounded-lg bg-magic-soft/50 px-3 py-2 text-xs text-magic-ink/70">
          {h.notes}
        </p>
      )}

      {assigned && (
        <p className="mt-2 text-xs text-magic-ink/55">
          Assigned to <span className="font-semibold text-magic-ink/80">{assigned}</span>
          {h.assigned_at && <> · {new Date(h.assigned_at).toLocaleDateString()}</>}
        </p>
      )}

      {canAssign && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-magic-border/60 pt-3">
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-2 py-1.5 text-xs"
          >
            <option value="">Select member…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name || u.username}
              </option>
            ))}
          </select>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
            className="rounded border border-magic-border bg-white px-2 py-1.5 text-xs"
          >
            <option value="engineer">Engineer</option>
            <option value="technical">Technical</option>
            <option value="manager">Manager</option>
          </select>
          <button
            onClick={() => void assign()}
            disabled={busy || !assignee}
            className="rounded bg-magic-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red disabled:opacity-50 transition-colors"
          >
            {busy ? "Assigning…" : h.status === "assigned" ? "Reassign" : "Assign member"}
          </button>
        </div>
      )}
    </li>
  );
}
