"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface EditableFolder {
  id: number;
  name: string;
  client_email: string | null;
  client_phone: string | null;
  client_company: string | null;
}

export function EditFolderDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: EditableFolder;
  onClose: () => void;
  onSaved: (f: EditableFolder) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.client_email ?? "");
  const [phone, setPhone] = useState(initial.client_phone ?? "");
  const [company, setCompany] = useState(initial.client_company ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders?id=${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          client_email: email.trim() || null,
          client_phone: phone.trim() || null,
          client_company: company.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onSaved({
        id: initial.id,
        name: data.folder.name,
        client_email: data.folder.client_email,
        client_phone: data.folder.client_phone,
        client_company: data.folder.client_company,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-magic-ink">Edit client</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ×
          </button>
        </div>
        <input
          type="text"
          placeholder="Name (required)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoFocus
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <input
          type="tel"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Company (free text)"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          disabled={busy}
          className="w-full rounded border border-magic-border bg-white px-3 py-2 text-sm"
        />
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            className="rounded bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditFolderButton({ folder }: { folder: EditableFolder }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
      >
        Edit
      </button>
      {open && (
        <EditFolderDialog
          initial={folder}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
