"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
}

export default function CompanyDetail({ id }: { id: number }) {
  const router = useRouter();
  const [c, setC] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
  }

  useEffect(() => {
    load();
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
        <form
          onSubmit={save}
          className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl border border-magic-border bg-white p-4"
        >
          <Field label="Name" value={c.name} onChange={(v) => setC({ ...c, name: v })} />
          <Field label="Website" value={c.website ?? ""} onChange={(v) => setC({ ...c, website: v })} />
          <Field label="Industry" value={c.industry ?? ""} onChange={(v) => setC({ ...c, industry: v })} />
          <Field
            label="Size bucket"
            value={c.size_bucket ?? ""}
            onChange={(v) => setC({ ...c, size_bucket: v })}
          />
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Notes</label>
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
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase text-magic-ink/60 mb-3">People</h2>
        <div className="rounded-2xl border border-magic-border bg-white p-3">
          {contacts.length === 0 ? (
            <p className="text-xs text-magic-ink/60">No contacts at this company yet.</p>
          ) : (
            <ul className="space-y-1">
              {contacts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/crm/contacts/${p.id}`}
                    className="block rounded-md px-2 py-1 text-sm text-magic-ink/80 hover:bg-magic-soft hover:text-magic-red"
                  >
                    {`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.email || "(unnamed)"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
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
      <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
      />
    </div>
  );
}
