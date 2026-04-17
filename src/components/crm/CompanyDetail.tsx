"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NotesPanel from "@/components/crm/NotesPanel";

interface Company {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
  folder_id: number | null;
}

interface Contact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
}

interface Quotation {
  id: number;
  ref: string;
  project_name: string;
  status: string;
  parent_ref: string | null;
  updated_at: string;
  folder_id: number | null;
  contact_id: number | null;
}

// Pre-baked size buckets matching common HR/CRM ranges. The DB column is a
// free-text field so callers can still write anything via the API; the UI
// just nudges everyone toward the same vocabulary.
const SIZE_BUCKETS = ["1–10", "11–50", "51–200", "201–1000", "1000+"];

function personLabel(p: Contact): string {
  return (
    `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() ||
    p.email ||
    "(unnamed)"
  );
}

export default function CompanyDetail({ id }: { id: number }) {
  const router = useRouter();
  const [c, setC] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [folderQuotations, setFolderQuotations] = useState<Quotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // ── Add-person inline form state ───────────────────────────────────────
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPerson, setNewPerson] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    title: "",
  });
  const [addingPerson, setAddingPerson] = useState(false);
  const [addPersonError, setAddPersonError] = useState<string | null>(null);

  // ── Assignment UI state ────────────────────────────────────────────────
  // Pending dropdown selections, keyed by quotation id — lets each row carry
  // its own "Assign to: [person]" choice before the user clicks Assign.
  const [assignChoice, setAssignChoice] = useState<Record<number, number | "">>(
    {},
  );
  // Tracks the quotation currently being PATCHed so the Assign/Unassign
  // button can show a disabled "Saving…" state without blocking the rest.
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  async function loadFolderQuotations(folderId: number | null) {
    if (!folderId) {
      setFolderQuotations([]);
      return;
    }
    try {
      const res = await fetch(`/api/quotations?folder_id=${folderId}`);
      const data = await res.json();
      setFolderQuotations(data.quotations ?? []);
    } catch {
      // Transient; leave the prior list in place.
    }
  }

  async function load() {
    setError(null);
    const [comp, cts] = await Promise.all([
      fetch(`/api/crm/companies/${id}`).then((r) => r.json()),
      fetch(`/api/crm/contacts?company_id=${id}`).then((r) => r.json()),
    ]);
    if (comp.error) {
      setError(comp.error);
      return;
    }
    setC(comp.company);
    setContacts(cts.contacts ?? []);
    await loadFolderQuotations(comp.company?.folder_id ?? null);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!c) return;
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`/api/crm/companies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setC(data.company);
      setStatus("Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this company?")) return;
    const res = await fetch(`/api/crm/companies/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/crm/companies");
  }

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    setAddPersonError(null);
    // The API requires at least one of first_name / last_name / email / phone.
    if (
      !newPerson.first_name.trim() &&
      !newPerson.last_name.trim() &&
      !newPerson.email.trim() &&
      !newPerson.phone.trim()
    ) {
      setAddPersonError("Enter at least a name, email, or phone.");
      return;
    }
    setAddingPerson(true);
    try {
      const res = await fetch(`/api/crm/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: id,
          // Inherit the company's folder_id so the new contact lives in the
          // same client folder used for quotation context.
          folder_id: c?.folder_id ?? null,
          first_name: newPerson.first_name.trim() || null,
          last_name: newPerson.last_name.trim() || null,
          email: newPerson.email.trim() || null,
          phone: newPerson.phone.trim() || null,
          title: newPerson.title.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "could not add person");
      setNewPerson({ first_name: "", last_name: "", email: "", phone: "", title: "" });
      setShowAddPerson(false);
      await load();
    } catch (err) {
      setAddPersonError((err as Error).message);
    } finally {
      setAddingPerson(false);
    }
  }

  // PATCH /api/quotations?id=<n> with the new contact_id. `null` unassigns.
  // Always refreshes the folder list from the server afterwards so every
  // card (assigned + unassigned) reflects the authoritative state.
  async function assignQuotation(
    quotationId: number,
    nextContactId: number | null,
  ) {
    setAssigningId(quotationId);
    setAssignError(null);
    try {
      const res = await fetch(`/api/quotations?id=${quotationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: nextContactId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await loadFolderQuotations(c?.folder_id ?? null);
      // Clear the pending dropdown choice for this row once persisted.
      setAssignChoice((prev) => {
        const next = { ...prev };
        delete next[quotationId];
        return next;
      });
    } catch (err) {
      setAssignError((err as Error).message);
    } finally {
      setAssigningId(null);
    }
  }

  const designerHref = useMemo(() => {
    if (!c?.folder_id) return null;
    return `/designer?folder=${c.folder_id}&new=1`;
  }, [c?.folder_id]);

  // Group quotations by contact for the People cards + separate list of the
  // rows that still need a person. Memoised so re-renders (e.g. typing into
  // the notes textarea) don't rebuild the maps.
  const { quotationsByContact, unassignedQuotations } = useMemo(() => {
    const byContact: Record<number, Quotation[]> = {};
    const unassigned: Quotation[] = [];
    for (const q of folderQuotations) {
      if (q.contact_id == null) {
        unassigned.push(q);
      } else {
        (byContact[q.contact_id] = byContact[q.contact_id] || []).push(q);
      }
    }
    return { quotationsByContact: byContact, unassignedQuotations: unassigned };
  }, [folderQuotations]);

  if (error && !c) return <p className="text-sm text-red-600">{error}</p>;
  if (!c) return <p className="text-sm text-magic-ink/60">Loading…</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-magic-ink">{c.name}</h1>
          <div className="flex gap-2">
            <Link
              href="/crm/companies"
              className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              ← Back
            </Link>
            <button
              onClick={remove}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* ── Company parameters form ─────────────────────────────── */}
        <form
          onSubmit={save}
          className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl border border-magic-border bg-white p-4"
        >
          <Field label="Name" value={c.name} onChange={(v) => setC({ ...c, name: v })} />
          <Field
            label="Website"
            value={c.website ?? ""}
            onChange={(v) => setC({ ...c, website: v })}
          />
          <Field
            label="Industry"
            value={c.industry ?? ""}
            onChange={(v) => setC({ ...c, industry: v })}
          />
          <div>
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
              Size bucket
            </label>
            <select
              value={c.size_bucket ?? ""}
              onChange={(e) => setC({ ...c, size_bucket: e.target.value || null })}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            >
              <option value="">— Choose size —</option>
              {SIZE_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
              Notes
            </label>
            <textarea
              value={c.notes ?? ""}
              onChange={(e) => setC({ ...c, notes: e.target.value })}
              rows={5}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {status && <span className="text-xs text-green-700">{status}</span>}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </form>

        {/* ── People + their quotations ──────────────────────────── */}
        <section className="rounded-2xl border border-magic-border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase text-magic-ink/60">
              People &amp; quotations
            </h2>
            <button
              type="button"
              onClick={() => setShowAddPerson((v) => !v)}
              className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
            >
              {showAddPerson ? "Cancel" : "+ Add person"}
            </button>
          </div>

          {showAddPerson && (
            <form
              onSubmit={addPerson}
              className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-xl border border-magic-border bg-magic-soft/40 p-3 mb-4"
            >
              <Field
                label="First name"
                value={newPerson.first_name}
                onChange={(v) => setNewPerson({ ...newPerson, first_name: v })}
              />
              <Field
                label="Last name"
                value={newPerson.last_name}
                onChange={(v) => setNewPerson({ ...newPerson, last_name: v })}
              />
              <Field
                label="Title"
                value={newPerson.title}
                onChange={(v) => setNewPerson({ ...newPerson, title: v })}
              />
              <Field
                label="Email"
                value={newPerson.email}
                onChange={(v) => setNewPerson({ ...newPerson, email: v })}
              />
              <Field
                label="Phone"
                value={newPerson.phone}
                onChange={(v) => setNewPerson({ ...newPerson, phone: v })}
              />
              <div className="md:col-span-2 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={addingPerson}
                  className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {addingPerson ? "Adding…" : "Add person"}
                </button>
                {addPersonError && (
                  <span className="text-xs text-red-600">{addPersonError}</span>
                )}
              </div>
            </form>
          )}

          {contacts.length === 0 ? (
            <p className="text-xs text-magic-ink/60">
              No contacts at this company yet. Click{" "}
              <span className="font-semibold">+ Add person</span> to create one.
            </p>
          ) : (
            <ul className="space-y-3">
              {contacts.map((p) => {
                const personQuotes = quotationsByContact[p.id] ?? [];
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-magic-border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/crm/contacts/${p.id}`}
                          className="text-sm font-semibold text-magic-ink hover:text-magic-red"
                        >
                          {personLabel(p)}
                        </Link>
                        <div className="text-xs text-magic-ink/60 mt-0.5 space-x-2">
                          {p.title && <span>{p.title}</span>}
                          {p.email && (
                            <span>
                              <a
                                href={`mailto:${p.email}`}
                                className="hover:text-magic-red"
                              >
                                {p.email}
                              </a>
                            </span>
                          )}
                          {p.phone && <span>· {p.phone}</span>}
                        </div>
                      </div>
                      {designerHref && (
                        <Link
                          href={`${designerHref}&contact=${p.id}`}
                          className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft whitespace-nowrap"
                        >
                          + New quotation
                        </Link>
                      )}
                    </div>

                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase text-magic-ink/50 mb-1">
                        Quotations
                      </p>
                      {personQuotes.length === 0 ? (
                        <p className="text-xs text-magic-ink/60">
                          No quotations linked to this person yet.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {personQuotes.map((q) => (
                            <li
                              key={q.id}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <Link
                                href={`/quotation?id=${q.id}`}
                                className="text-magic-ink/80 hover:text-magic-red"
                              >
                                <span className="font-mono font-semibold">
                                  {q.ref}
                                </span>{" "}
                                <span className="text-magic-ink/60">
                                  — {q.project_name}
                                </span>
                              </Link>
                              <div className="flex items-center gap-2">
                                <span className="text-magic-ink/40">
                                  {q.status}
                                </span>
                                <button
                                  type="button"
                                  disabled={assigningId === q.id}
                                  onClick={() => assignQuotation(q.id, null)}
                                  className="text-magic-ink/50 hover:text-magic-red disabled:opacity-60"
                                  title="Unassign from this person"
                                >
                                  Unassign
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!designerHref && contacts.length > 0 && (
            <p className="mt-3 text-[11px] text-magic-ink/50">
              Tip: link this company to a client folder to enable
              &ldquo;+ New quotation&rdquo; per person.
            </p>
          )}
        </section>

        {/* ── Unassigned quotations for this company ──────────────── */}
        {/* Shown only when the company has a folder (so we can query its
            quotations) AND the user has at least one contact to assign to.
            Legacy rows created before the contact_id column land here so
            they can be retroactively attributed. */}
        {c.folder_id && unassignedQuotations.length > 0 && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase text-amber-800">
                Unassigned quotations
              </h2>
              <span className="text-xs text-amber-800/70">
                {unassignedQuotations.length} total
              </span>
            </div>
            <p className="text-xs text-amber-900/80 mb-3">
              These quotations belong to this company but aren&rsquo;t linked
              to a person yet. Pick someone and click Assign.
            </p>
            {contacts.length === 0 ? (
              <p className="text-xs text-amber-900/80">
                Add a person first (above), then come back to assign.
              </p>
            ) : (
              <ul className="space-y-2">
                {unassignedQuotations.map((q) => {
                  const choice = assignChoice[q.id] ?? "";
                  return (
                    <li
                      key={q.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-2 text-xs"
                    >
                      <Link
                        href={`/quotation?id=${q.id}`}
                        className="text-magic-ink/80 hover:text-magic-red"
                      >
                        <span className="font-mono font-semibold">{q.ref}</span>{" "}
                        <span className="text-magic-ink/60">
                          — {q.project_name}
                        </span>
                      </Link>
                      <div className="flex items-center gap-2">
                        <select
                          value={choice}
                          onChange={(e) =>
                            setAssignChoice((prev) => ({
                              ...prev,
                              [q.id]: e.target.value
                                ? Number(e.target.value)
                                : "",
                            }))
                          }
                          className="rounded-md border border-magic-border px-2 py-1 text-xs"
                        >
                          <option value="">— Pick a person —</option>
                          {contacts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {personLabel(p)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!choice || assigningId === q.id}
                          onClick={() =>
                            typeof choice === "number" &&
                            assignQuotation(q.id, choice)
                          }
                          className="rounded-md bg-magic-red text-white px-3 py-1 text-xs font-semibold disabled:opacity-50"
                        >
                          {assigningId === q.id ? "Saving…" : "Assign"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {assignError && (
              <p className="mt-2 text-xs text-red-600">{assignError}</p>
            )}
          </section>
        )}
      </div>

      <div className="space-y-6">
        <NotesPanel entityType="company" entityId={id} />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
      />
    </div>
  );
}
