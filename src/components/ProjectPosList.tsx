"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

/**
 * Purchase-orders list with a search box, mirroring the Quotations
 * tab pattern. Server already loaded every PO for the project.
 * Filter is client-side over PO number / supplier / quotation ref /
 * status / project name.
 */

export interface ProjectPoRow {
  id: number;
  po_number: string;
  supplier: string | null;
  status: string;
  amount: number;
  currency: string;
  issued_at: string | null;
  expected_at: string | null;
  quotation_id: number | null;
  quotation_ref: string | null;
}

export default function ProjectPosList({ rows }: { rows: ProjectPoRow[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const lc = query.trim().toLowerCase();
    if (!lc) return rows;
    return rows.filter((r) => {
      const hay = [
        r.po_number,
        r.supplier,
        r.quotation_ref,
        r.status,
        r.currency,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(lc);
    });
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <input
        type="search"
        placeholder="Search PO #, supplier, quotation ref, status…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
      />

      {visible.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          {query
            ? `No matches for "${query}".`
            : "No purchase orders filed under this project yet."}
        </p>
      ) : (
        <div className="rounded-lg border border-magic-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-magic-soft/40 text-xs uppercase text-magic-ink/60">
              <tr>
                <th className="text-left px-3 py-2">PO #</th>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-left px-3 py-2">From quotation</th>
                <th className="text-right px-3 py-2">Amount</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Issued / due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-magic-border/60">
              {visible.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    <Link
                      href={`/purchase-orders?id=${r.id}`}
                      className="text-magic-red hover:underline"
                    >
                      {r.po_number}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{r.supplier || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-magic-ink/60">
                    {r.quotation_ref ? (
                      <Link
                        href={`/quotation?id=${r.quotation_id}`}
                        className="hover:text-magic-red"
                      >
                        {r.quotation_ref}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {r.amount} {r.currency}
                  </td>
                  <td className="px-3 py-1.5 text-xs uppercase text-magic-ink/60">
                    {r.status}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-magic-ink/60">
                    {r.issued_at
                      ? new Date(r.issued_at).toLocaleDateString()
                      : "—"}
                    {r.expected_at && (
                      <> → {new Date(r.expected_at).toLocaleDateString()}</>
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
