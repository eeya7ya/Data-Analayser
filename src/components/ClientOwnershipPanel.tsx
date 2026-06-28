"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MoveOwnerButton from "@/components/MoveOwnerButton";

/**
 * Admin tool: move any client (company or individual) to another presales user
 * from one place, without having to open the CRM lists. Lists every company and
 * individual with its current owner and a "Move owner" action per row that
 * hands the whole client over via /api/crm/reassign-owner.
 */
interface ClientRow {
  id: number;
  name: string;
  owner: string | null;
  kind: "company" | "individual";
}

export default function ClientOwnershipPanel({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, fRes] = await Promise.all([
        fetch("/api/companies", { cache: "no-store" }),
        fetch("/api/folders?kind=individual", { cache: "no-store" }),
      ]);
      const cData = (await cRes.json()) as {
        companies?: Array<{ id: number; name: string; owner_username: string | null }>;
        error?: string;
      };
      const fData = (await fRes.json()) as {
        folders?: Array<{
          id: number;
          name: string;
          owner_username: string | null;
          kind: string | null;
        }>;
        error?: string;
      };
      if (cData.error) throw new Error(cData.error);
      if (fData.error) throw new Error(fData.error);
      const companies: ClientRow[] = (cData.companies ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        owner: c.owner_username,
        kind: "company",
      }));
      const individuals: ClientRow[] = (fData.folders ?? [])
        .filter((f) => f.kind === "individual")
        .map((f) => ({
          id: f.id,
          name: f.name,
          owner: f.owner_username,
          kind: "individual",
        }));
      setRows([...companies, ...individuals]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    const filtered = !lc
      ? rows
      : rows.filter(
          (r) =>
            r.name.toLowerCase().includes(lc) ||
            (r.owner ?? "").toLowerCase().includes(lc),
        );
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-magic-ink/60">
        Move a company or individual — and everything filed under it (folders,
        contacts, projects, quotations) — to another presales user.
      </p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search clients or owners…"
        className="w-full max-w-sm rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm focus:border-magic-red focus:outline-none focus:ring-1 focus:ring-magic-red"
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-magic-ink/50">Loading clients…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-magic-ink/50">No clients found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-magic-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-magic-border bg-magic-soft/40 text-left text-xs text-magic-ink/60">
                <th className="px-3 py-2 font-semibold">Client</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Current owner</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={`${r.kind}-${r.id}`}
                  className="border-b border-magic-border/60 last:border-0"
                >
                  <td className="px-3 py-2 font-medium text-magic-ink">{r.name}</td>
                  <td className="px-3 py-2 text-magic-ink/60 capitalize">{r.kind}</td>
                  <td className="px-3 py-2 text-magic-ink/70">
                    {r.owner ? `@${r.owner}` : "Unassigned"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!readOnly && (
                      <MoveOwnerButton
                        kind={r.kind}
                        id={r.id}
                        name={r.name}
                        onMoved={() => void load()}
                      />
                    )}
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
