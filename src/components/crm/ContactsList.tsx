"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/crm/fetchJson";

interface Contact {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  company_id: number | null;
  folder_id: number | null;
  updated_at: string;
}

interface Folder {
  id: number;
  name: string;
}

export default function ContactsList() {
  const [items, setItems] = useState<Contact[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    title: "",
    folder_id: "" as string | number,
  });

  async function load() {
    setError(null);
    try {
      const [c, f] = await Promise.all([
        fetchJson<{ contacts?: Contact[] }>("/api/crm/contacts"),
        fetchJson<{ folders?: Folder[] }>("/api/folders"),
      ]);
      setItems(c.contacts ?? []);
      setFolders(f.folders ?? []);
    } catch (err) {
      setError((err as Error).message);
      setItems((prev) => prev ?? []);
    }
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
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setShowNew(false);
      setDraft({ first_name: "", last_name: "", email: "", phone: "", title: "", folder_id: "" });
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
        <h1 className="text-2xl font-bold text-magic-ink">Contacts</h1>
        <button
          onClick={() => setShowNew((s) => !s)}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          {showNew ? "Cancel" : "New contact"}
        </button>
      </div>

      {showNew && (
        <form
          onSubmit={create}
          className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl border border-magic-border bg-white p-4"
        >
          <Input label="First name" value={draft.first_name} onChange={(v) => setDraft({ ...draft, first_name: v })} />
          <Input label="Last name" value={draft.last_name} onChange={(v) => setDraft({ ...draft, last_name: v })} />
          <Input label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
          <Input label="Email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
          <Input label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} />
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
          <div className="md:col-span-3 flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-magic-ink text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create contact"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {items === null ? (
        <p className="text-sm text-magic-ink/60">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-magic-ink/60">No contacts yet.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-magic-border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-magic-soft/60 text-xs font-semibold uppercase text-magic-ink/60">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Phone</th>
                <th className="px-4 py-3 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(no name)";
                return (
                  <tr key={c.id} className="border-t border-magic-border/50 hover:bg-magic-soft/30">
                    <td className="px-4 py-3">
                      <Link href={`/crm/contacts/${c.id}`} className="font-medium text-magic-red hover:underline">
                        {name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-magic-ink/70">{c.title || "—"}</td>
                    <td className="px-4 py-3 text-magic-ink/70">{c.email || "—"}</td>
                    <td className="px-4 py-3 text-magic-ink/70">{c.phone || "—"}</td>
                    <td className="px-4 py-3 text-magic-ink/50">
                      {new Date(c.updated_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
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
