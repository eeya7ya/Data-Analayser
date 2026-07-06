"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UserPlus,
  ClipboardList,
  Trash2,
  Send,
  MapPin,
  CalendarDays,
  Flag,
} from "lucide-react";
import { confirmDelete } from "@/lib/confirmDelete";
import Spinner from "@/components/Spinner";

/**
 * Project distribution tool — the project manager's "work order". Instead of
 * quoting, the PM distributes the project to a technician / engineer: client
 * context (prefilled from the folder but editable), an assignee + role, a
 * scope of work, dates, an execution status and notes. Each distribution is
 * an enriched project assignment, so it also grants the assignee access.
 */

interface Assignee {
  id: number;
  username: string;
  display_name: string | null;
  project_roles: string | null;
}

interface MasterJob {
  id: number;
  name: string;
  items: string[];
}

interface Distribution {
  id: number;
  user_id: number;
  username: string;
  role: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  scope_of_work: string | null;
  status: string | null;
  company_name: string | null;
  client_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

const ROLES: Array<[string, string]> = [
  ["technical", "Technician"],
  ["engineer", "Engineer"],
  ["manager", "Manager"],
];

/** The role follows the assignee — derived from their project grants, so the
 *  PM never re-selects it. Prefers technician, then engineer, then manager. */
function roleForAssignee(a?: { project_roles: string | null }): string {
  const roles = (a?.project_roles || "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  if (roles.includes("technical")) return "technical";
  if (roles.includes("engineer")) return "engineer";
  if (roles.includes("manager")) return "manager";
  return "technical";
}
const STATUSES: Array<[string, string]> = [
  ["assigned", "Assigned"],
  ["in_progress", "In progress"],
  ["done", "Done"],
  ["on_hold", "On hold"],
];

interface FormState {
  company_name: string;
  client_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  location: string;
  user_id: string;
  role: string;
  scope_of_work: string;
  start_date: string;
  end_date: string;
  status: string;
  notes: string;
  template_id: string;
}

const BLANK: FormState = {
  company_name: "",
  client_name: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  location: "",
  user_id: "",
  role: "technical",
  scope_of_work: "",
  start_date: "",
  end_date: "",
  status: "assigned",
  notes: "",
  template_id: "",
};

export default function ProjectDistribution({
  projectId,
}: {
  projectId: number;
}) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [masterJobs, setMasterJobs] = useState<MasterJob[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [form, setForm] = useState<FormState>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ctxRes, listRes, jobsRes] = await Promise.all([
        fetch(`/api/project-distributions/context?project_id=${projectId}`, {
          cache: "no-store",
        }),
        fetch(`/api/project-assignments?project_id=${projectId}`, {
          cache: "no-store",
        }),
        fetch(`/api/checklist-templates`, { cache: "no-store" }),
      ]);
      const ctx = await ctxRes.json();
      const list = await listRes.json();
      const jobs = await jobsRes.json().catch(() => ({}));
      if (!ctxRes.ok) throw new Error(ctx.error || "Failed to load");
      setAssignees(ctx.assignees || []);
      setDistributions(list.assignments || []);
      setMasterJobs(jobsRes.ok ? jobs.templates || [] : []);
      // Seed the form's client context from the folder (editable).
      setForm((f) => ({
        ...f,
        company_name: f.company_name || ctx.prefill?.company_name || "",
        client_name: f.client_name || ctx.prefill?.client_name || "",
        contact_name: f.contact_name || ctx.prefill?.contact_name || "",
        contact_email: f.contact_email || ctx.prefill?.contact_email || "",
        contact_phone: f.contact_phone || ctx.prefill?.contact_phone || "",
        location: f.location || ctx.prefill?.location || "",
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.user_id) {
      setError("Pick a technician or engineer to distribute to.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/project-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          user_id: Number(form.user_id),
          role: form.role,
          scope_of_work: form.scope_of_work || null,
          status: form.status,
          company_name: form.company_name || null,
          client_name: form.client_name || null,
          contact_name: form.contact_name || null,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          location: form.location || null,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          notes: form.notes || null,
          template_id: form.template_id ? Number(form.template_id) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to distribute");
      // Keep the client context, reset the per-assignee fields.
      setForm((f) => ({
        ...BLANK,
        company_name: f.company_name,
        client_name: f.client_name,
        contact_name: f.contact_name,
        contact_email: f.contact_email,
        contact_phone: f.contact_phone,
        location: f.location,
      }));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(d: Distribution, status: string) {
    setDistributions((list) =>
      list.map((x) => (x.id === d.id ? { ...x, status } : x)),
    );
    try {
      const res = await fetch("/api/project-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Send the full distribution field-set — the PATCH replaces them.
        body: JSON.stringify({
          id: d.id,
          status,
          scope_of_work: d.scope_of_work,
          location: d.location,
          notes: d.notes,
          company_name: d.company_name,
          client_name: d.client_name,
          contact_name: d.contact_name,
          contact_email: d.contact_email,
          contact_phone: d.contact_phone,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
    } catch (err) {
      setError((err as Error).message);
      await load();
    }
  }

  async function remove(d: Distribution) {
    if (!confirmDelete(`Remove ${d.username} from this project?`)) return;
    try {
      const res = await fetch("/api/project-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-magic-ink/60">
        <Spinner size={16} /> Loading distribution…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700"
        >
          {error}
        </div>
      )}

      {/* ── The distribution "designer" form ── */}
      <form
        onSubmit={submit}
        className="rounded-2xl border border-magic-border bg-magic-soft/30 p-4 sm:p-5"
      >
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-magic-red" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-magic-ink/70">
            New distribution
          </h3>
        </div>

        {/* Client context — prefilled from the folder, editable. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Company">
            <input
              className={inputCls}
              value={form.company_name}
              onChange={(e) => set("company_name", e.target.value)}
            />
          </Field>
          <Field label="Client">
            <input
              className={inputCls}
              value={form.client_name}
              onChange={(e) => set("client_name", e.target.value)}
            />
          </Field>
          <Field label="Contact">
            <input
              className={inputCls}
              value={form.contact_name}
              onChange={(e) => set("contact_name", e.target.value)}
            />
          </Field>
          <Field label="Email">
            <input
              className={inputCls}
              value={form.contact_email}
              onChange={(e) => set("contact_email", e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputCls}
              value={form.contact_phone}
              onChange={(e) => set("contact_phone", e.target.value)}
            />
          </Field>
          <Field label="Location / site">
            <div className="flex gap-1.5">
              <input
                className={inputCls}
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Site address / area"
              />
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  form.location || form.company_name || "",
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Pick / view on Google Maps"
                className="inline-flex flex-shrink-0 items-center justify-center rounded-lg border border-magic-border bg-white px-2.5 text-magic-ink/60 transition-colors hover:border-magic-red/50 hover:text-magic-red"
              >
                <MapPin className="h-4 w-4" />
              </a>
            </div>
          </Field>
        </div>

        {/* Free, keyless Google Maps preview of the typed location. */}
        {form.location.trim() && (
          <div className="mt-3 overflow-hidden rounded-xl border border-magic-border">
            <iframe
              title="Site location"
              className="h-48 w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(
                form.location,
              )}&z=14&output=embed`}
            />
          </div>
        )}

        <div className="my-4 h-px bg-magic-border" />

        {/* Assignment + scope. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Assign to">
            <select
              className={inputCls}
              value={form.user_id}
              onChange={(e) => {
                // The role follows the person — a technician is assigned as a
                // technician, an engineer as an engineer — so there is nothing
                // to re-select.
                const uid = e.target.value;
                const a = assignees.find((x) => String(x.id) === uid);
                setForm((f) => ({ ...f, user_id: uid, role: roleForAssignee(a) }));
              }}
              required
            >
              <option value="">Select a technician / engineer…</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.display_name?.trim() || a.username) +
                    ` — ${ROLES.find(([v]) => v === roleForAssignee(a))?.[1] ?? "Technician"}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned as">
            <div className={`${inputCls} bg-magic-soft/40 text-magic-ink/70`}>
              {form.user_id
                ? ROLES.find(([v]) => v === form.role)?.[1] ?? "Technician"
                : "—"}
            </div>
          </Field>
          <Field label="Start date">
            <input
              type="date"
              className={inputCls}
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </Field>
          <Field label="Target date">
            <input
              type="date"
              className={inputCls}
              value={form.end_date}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </Field>
        </div>

        {/* Master job — its checklist seeds this project on distribute. */}
        <div className="mt-3">
          <Field label="Master job (seeds the checklist)">
            <select
              className={inputCls}
              value={form.template_id}
              onChange={(e) => set("template_id", e.target.value)}
            >
              <option value="">
                {masterJobs.length
                  ? "No master job — checklist stays as-is"
                  : "No master jobs yet — design them in the Checklist Designer"}
              </option>
              {masterJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name} ({j.items.length} step{j.items.length === 1 ? "" : "s"})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="Scope of work">
            <textarea
              className={`${inputCls} min-h-[70px] resize-y`}
              value={form.scope_of_work}
              onChange={(e) => set("scope_of_work", e.target.value)}
              placeholder="What this person should execute…"
            />
          </Field>
          <Field label="Execution notes">
            <textarea
              className={`${inputCls} min-h-[70px] resize-y`}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Instructions, constraints, materials…"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="w-40">
            <Field label="Status">
              <select
                className={inputCls}
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {STATUSES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-magic-red px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-magic-red/90 disabled:opacity-60"
          >
            {saving ? (
              <Spinner size={14} className="text-white" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Distribute to execution
          </button>
        </div>
      </form>

      {/* ── Current distributions ── */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-magic-ink/50" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-magic-ink/60">
            Distributed to ({distributions.length})
          </h3>
        </div>
        {distributions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-magic-border p-5 text-center text-sm text-magic-ink/50">
            Not distributed yet. Assign a technician or engineer above to start
            execution.
          </p>
        ) : (
          <ul className="space-y-2">
            {distributions.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-magic-border bg-white p-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-magic-ink">
                      {d.username}{" "}
                      <span className="font-normal text-magic-ink/50">
                        · {ROLES.find(([v]) => v === d.role)?.[1] || d.role}
                      </span>
                    </p>
                    {d.scope_of_work && (
                      <p className="mt-0.5 text-xs text-magic-ink/70">
                        {d.scope_of_work}
                      </p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-magic-ink/45">
                      {d.location && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            d.location,
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 hover:text-magic-red"
                        >
                          <MapPin className="h-3 w-3" /> {d.location}
                        </a>
                      )}
                      {d.start_date && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" /> {d.start_date}
                        </span>
                      )}
                      {d.end_date && (
                        <span className="inline-flex items-center gap-1">
                          <Flag className="h-3 w-3" /> {d.end_date}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={d.status || "assigned"}
                      onChange={(e) => void changeStatus(d, e.target.value)}
                      className="rounded-lg border border-magic-border bg-white px-2 py-1 text-xs font-semibold"
                    >
                      {STATUSES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void remove(d)}
                      title="Remove from project"
                      className="rounded-lg border border-magic-border p-1.5 text-magic-ink/50 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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

const inputCls =
  "block w-full rounded-lg border border-magic-border bg-white px-2.5 py-1.5 text-sm text-magic-ink focus:border-magic-red/50 focus:outline-none focus:ring-2 focus:ring-magic-red/20";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-magic-ink/50">
        {label}
      </span>
      {children}
    </label>
  );
}
