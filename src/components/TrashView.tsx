"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * TrashView — the "junction box" for soft-deleted client folders and
 * quotations. Items listed here never auto-purge; the only operations are
 * "Restore" (undo the delete) and "look at them". There is deliberately
 * NO permanent-delete button.
 */

interface TrashFolder {
  id: number;
  name: string;
  owner_id: number | null;
  deleted_at: string;
  client_email: string | null;
  client_phone: string | null;
  client_company: string | null;
  owner_username?: string | null;
  owner_display_name?: string | null;
}

interface TrashQuotation {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  site_name: string;
  folder_id: number | null;
  owner_id: number | null;
  deleted_at: string;
  owner_username?: string | null;
  owner_display_name?: string | null;
}

function formatDateTime(dt: string) {
  const d = new Date(dt);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export default function TrashView({ isAdmin }: { isAdmin: boolean }) {
  const [folders, setFolders] = useState<TrashFolder[]>([]);
  const [quotations, setQuotations] = useState<TrashQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringKind, setRestoringKind] = useState<string | null>(null);
  // We purposely leave `isAdmin` reserved for future admin-only restore UI
  // (e.g. bulk empty). For now the API already scopes results server-side.
  void isAdmin;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trash");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load trash");
      setFolders(data.folders || []);
      setQuotations(data.quotations || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function restore(type: "folder" | "quotation", id: number) {
    const key = `${type}:${id}`;
    setRestoringKind(key);
    setError(null);
    try {
      const res = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, cascade: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Restore failed");
      if (type === "folder") {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        // Restoring a folder cascade-restores its quotations on the server;
        // reload so the quotations list matches reality. (The ones that stay
        // in trash are orphans the user soloed earlier.)
        load();
      } else {
        setQuotations((prev) => prev.filter((q) => q.id !== id));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoringKind(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-14 rounded-2xl border border-magic-border bg-white animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
        Items in the Trash are never deleted automatically. Use <em>Restore</em> to bring anything back.
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Clients / folders section */}
      <section>
        <h2 className="text-sm font-semibold text-magic-ink/80 mb-2">
          Clients ({folders.length})
        </h2>
        {folders.length === 0 ? (
          <div className="rounded-2xl border border-magic-border bg-white p-4 text-sm text-magic-ink/40">
            No clients in trash.
          </div>
        ) : (
          <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-magic-red text-xs uppercase bg-magic-soft/20">
                <tr>
                  <th className="p-3 text-left">Name</th>
                  <th className="p-3 text-left">Email</th>
                  <th className="p-3 text-left">Phone</th>
                  <th className="p-3 text-left">Company</th>
                  <th className="p-3 text-left">Deleted</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => {
                  const key = `folder:${f.id}`;
                  return (
                    <tr
                      key={f.id}
                      className="border-t border-magic-border hover:bg-magic-soft/10"
                    >
                      <td className="p-3 font-semibold">{f.name}</td>
                      <td className="p-3 text-magic-ink/70">{f.client_email || "—"}</td>
                      <td className="p-3 text-magic-ink/70">{f.client_phone || "—"}</td>
                      <td className="p-3 text-magic-ink/70">{f.client_company || "—"}</td>
                      <td className="p-3 text-xs text-magic-ink/60">
                        {formatDateTime(f.deleted_at)}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => restore("folder", f.id)}
                          disabled={restoringKind === key}
                          className="text-xs font-medium text-green-700 hover:underline disabled:opacity-50"
                        >
                          {restoringKind === key ? "Restoring…" : "Restore"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Quotations section */}
      <section>
        <h2 className="text-sm font-semibold text-magic-ink/80 mb-2">
          Quotations ({quotations.length})
        </h2>
        {quotations.length === 0 ? (
          <div className="rounded-2xl border border-magic-border bg-white p-4 text-sm text-magic-ink/40">
            No quotations in trash.
          </div>
        ) : (
          <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-magic-red text-xs uppercase bg-magic-soft/20">
                <tr>
                  <th className="p-3 text-left">Ref</th>
                  <th className="p-3 text-left">Project</th>
                  <th className="p-3 text-left">Client</th>
                  <th className="p-3 text-left">Site</th>
                  <th className="p-3 text-left">Deleted</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((r) => {
                  const key = `quotation:${r.id}`;
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-magic-border hover:bg-magic-soft/10"
                    >
                      <td className="p-3 font-mono">
                        <Link
                          href={`/quotation?id=${r.id}`}
                          className="text-magic-red hover:underline"
                        >
                          {r.ref}
                        </Link>
                      </td>
                      <td className="p-3">{r.project_name}</td>
                      <td className="p-3">{r.client_name || "—"}</td>
                      <td className="p-3">{r.site_name}</td>
                      <td className="p-3 text-xs text-magic-ink/60">
                        {formatDateTime(r.deleted_at)}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => restore("quotation", r.id)}
                          disabled={restoringKind === key}
                          className="text-xs font-medium text-green-700 hover:underline disabled:opacity-50"
                        >
                          {restoringKind === key ? "Restoring…" : "Restore"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
