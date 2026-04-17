"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Company {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  folder_id: number | null;
  updated_at: string;
}

interface Folder {
  id: number;
  name: string;
}

export default function CompaniesList() {
  const [items, setItems] = useState<Company[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    website: "",
    industry: "",
    size_bucket: "",
    folder_id: "" as string | number,
  });

  async function load() {
    setError(null);
    const [c, f] = await Promise.all([
      fetch("/api/crm/companies").then((r) => r.json()),
      fetch("/api/folders").then((r) => r.json()),
    ]);
    if (c.error) setError(c.error);
    setItems(c.companies ?? []);
    setFolders(f.folders ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const payload = {
        ...draft,
        folder_id: draft.folder_id ? Number(draft.folder_id) : null,
      };
      const res = await fetch("/api/crm/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setShowNew(false);
      setDraft({ name: "", website: "", industry: "", size_bucket: "", folder_id: "" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-magic-ink">Companies</h1>
        <button
          onClick={() => setShowNew((s) => !s)}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          {showNew ? "Cancel" : "New company"}
        </button>
      </div>

      {showNew && (
        <form
          onSubmit={create}
          className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl border border-magic-border bg-white p-4"
        >
          <Input label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <Input label="Website" value={draft.website} onChange={(v) => setDraft({ ...draft, website: v })} />
          <Input label="Industry" value={draft.industry} onChange={(v) => setDraft({ ...draft, industry: v })} />
          <Input
            label="Size bucket (1-10, 11-50…)"
            value={draft.size_bucket}
            onChange={(v) => setDraft({ ...draft, size_bucket: v })}
          />
          <div>
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Folder (client)</label>
            <select
              value={draft.folder_id}
              onChange={(e) => setDraft({ ...draft, folder_id: e.target.value })}
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
          <div className="md:col-span-2 flex gap-2">
            <button
              type="submit"
              disabled={creating || !draft.name.trim()}
              className="rounded-md bg-magic-ink text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create company"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {items === null ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/60">No companies yet.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-magic-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-magic-soft/60 text-xs font-semibold uppercase text-magic-ink/60">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Industry</th>
                <th className="px-4 py-3 text-left">Website</th>
                <th className="px-4 py-3 text-left">Size</th>
                <th className="px-4 py-3 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-magic-border/50 hover:bg-magic-soft/30">
                  <td className="px-4 py-3">
                    <Link href={`/crm/companies/${c.id}`} className="font-medium text-magic-red hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-magic-ink/70">{c.industry || "—"}</td>
                  <td className="px-4 py-3 text-magic-ink/70">{c.website || "—"}</td>
                  <td className="px-4 py-3 text-magic-ink/70">{c.size_bucket || "—"}</td>
                  <td className="px-4 py-3 text-magic-ink/50">
                    {new Date(c.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Input({
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
