"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Contact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  folder_id: number | null;
  company_id: number | null;
}

interface Folder {
  id: number;
  name: string;
}

interface ActivityRow {
  id: number;
  verb: string;
  meta_json: Record<string, unknown>;
  created_at: string;
  actor_username?: string | null;
}

export default function ContactDetail({ id }: { id: number }) {
  const router = useRouter();
  const [c, setC] = useState<Contact | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    setError(null);
    const [contactRes, foldersRes, activityRes] = await Promise.all([
      fetch(`/api/crm/contacts/${id}`).then((r) => r.json()),
      fetch(`/api/folders`).then((r) => r.json()),
      fetch(`/api/crm/activity?entity_type=contact&entity_id=${id}`).then((r) => r.json()).catch(() => ({})),
    ]);
    if (contactRes.error) {
      setError(contactRes.error);
      return;
    }
    setC(contactRes.contact);
    setFolders(foldersRes.folders ?? []);
    setActivity(activityRes.activity ?? []);
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
      const res = await fetch(`/api/crm/contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setC(data.contact);
      setStatus("Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this contact?")) return;
    const res = await fetch(`/api/crm/contacts/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/crm/contacts");
  }

  if (error && !c) return <p className="text-sm text-red-600">{error}</p>;
  if (!c) return <p className="text-sm text-magic-ink/60">Loading…</p>;

  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(no name)";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-magic-ink">{name}</h1>
          <div className="flex gap-2">
            <Link
              href="/crm/contacts"
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
          <Field
            label="First name"
            value={c.first_name ?? ""}
            onChange={(v) => setC({ ...c, first_name: v })}
          />
          <Field
            label="Last name"
            value={c.last_name ?? ""}
            onChange={(v) => setC({ ...c, last_name: v })}
          />
          <Field label="Title" value={c.title ?? ""} onChange={(v) => setC({ ...c, title: v })} />
          <Field label="Email" value={c.email ?? ""} onChange={(v) => setC({ ...c, email: v })} />
          <Field label="Phone" value={c.phone ?? ""} onChange={(v) => setC({ ...c, phone: v })} />
          <div>
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">
              Folder (client)
            </label>
            <select
              value={c.folder_id ?? ""}
              onChange={(e) =>
                setC({ ...c, folder_id: e.target.value ? Number(e.target.value) : null })
              }
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
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
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase text-magic-ink/60 mb-3">Activity</h2>
        <div className="rounded-2xl border border-magic-border bg-white p-3">
          {activity.length === 0 ? (
            <p className="text-xs text-magic-ink/60">No activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {activity.map((a) => (
                <li key={a.id} className="text-xs text-magic-ink/80">
                  <span className="font-semibold capitalize">{a.verb}</span>
                  <span className="text-magic-ink/50">
                    {" · "}
                    {new Date(a.created_at).toLocaleString()}
                  </span>
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
