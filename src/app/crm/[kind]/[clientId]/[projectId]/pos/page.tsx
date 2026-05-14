import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Purchase Orders tab for the project drill-down. Lists POs scoped
 * to this project; the existing /purchase-orders list is preserved
 * for any pre-V2 bookmark. Status / amount / supplier surface so the
 * caller doesn't have to drill in to triage the queue.
 */

interface PoRow {
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

export default async function ProjectPosTabPage({
  params,
}: {
  params: Promise<{ kind: string; clientId: string; projectId: string }>;
}) {
  const { kind, clientId, projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const projId = Number(projectId);
  const q = sql();
  const rows = (await q`
    select po.id, po.po_number, po.supplier, po.status,
           po.amount, po.currency, po.issued_at, po.expected_at,
           po.quotation_id, qq.ref as quotation_ref
    from purchase_orders po
    left join quotations qq on qq.id = po.quotation_id
    where po.project_id = ${projId}
      and po.deleted_at is null
    order by po.issued_at desc nulls last, po.id desc
    limit 200
  `) as PoRow[];

  const base = `/crm/${kind}/${clientId}/${projectId}`;
  void base;

  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-magic-ink">
            Purchase Orders
            <span className="ml-2 text-xs font-normal text-magic-ink/60">
              ({rows.length})
            </span>
          </h2>
          <p className="text-xs text-magic-ink/60">
            POs filed under this project. Convert a quotation to a PO from
            the quotation viewer.
          </p>
        </div>
        <Link
          href={`/purchase-orders?project=${projId}`}
          className="rounded-lg border border-magic-red text-magic-red px-3 py-1.5 text-xs font-semibold hover:bg-magic-red hover:text-white transition-colors"
        >
          Manage in legacy view →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No purchase orders filed under this project yet. Open a quotation
          and choose <strong>Convert to PO</strong> from the viewer.
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
              {rows.map((r) => (
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
    </section>
  );
}
