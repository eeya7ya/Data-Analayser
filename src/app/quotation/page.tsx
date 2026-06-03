import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import TopBar from "@/components/TopBar";
import QuotationViewer from "@/components/QuotationViewer";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
  tab?: string;
}

/**
 * Legacy /quotation route — V1.4C retired the old flat "Clients & Quotations"
 * list (and its trash tab) in favour of the CRM drill-down. What's left is a
 * thin compatibility shim so the many in-app links that only know a quotation
 * id keep working, while pushing viewing into the CRM:
 *
 *   • /quotation             → redirect to the CRM hub (the old list is gone)
 *   • /quotation?tab=trash    → redirect to the CRM trash
 *   • /quotation?id=<n>       → resolve the quotation's project/company home and
 *                               forward into the CRM viewer.
 *
 * Quotations with no project (NULL project_id) have no nested CRM home — the
 * CRM viewer is mounted under a project — so they fall back to the standalone
 * read-only viewer rendered here. That fallback is the only surface left that
 * can display a project-less quotation; everything else flows through the CRM.
 */
export default async function QuotationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;

  // The old list view (and its trash tab) are gone — send users into the CRM.
  if (!sp.id) {
    redirect(sp.tab === "trash" ? "/crm/trash" : "/crm");
  }

  const quotationId = Number(sp.id);
  if (!Number.isFinite(quotationId) || quotationId <= 0) {
    redirect("/crm");
  }

  // Resolve the quotation's CRM home: quotation → project → folder → company.
  // A complete, non-deleted chain means we can forward into the CRM viewer; a
  // missing chain (project-less quotation, or a deleted project / folder)
  // drops to the standalone viewer fallback below. A DB hiccup during
  // resolution also falls through to the viewer (which surfaces its own load
  // error gracefully) rather than 500-ing the whole page. The `redirect()`
  // call stays OUTSIDE the try/catch so its NEXT_REDIRECT signal isn't
  // swallowed.
  let home:
    | { id: number; project_id: number; folder_id: number; company_id: number | null }
    | undefined;
  try {
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select q.id, q.project_id, p.folder_id, f.company_id
      from quotations q
      join projects p on p.id = q.project_id and p.deleted_at is null
      join client_folders f on f.id = p.folder_id and f.deleted_at is null
      where q.id = ${quotationId} and q.deleted_at is null
      limit 1
    `) as Array<{
      id: number;
      project_id: number;
      folder_id: number;
      company_id: number | null;
    }>;
    home = rows[0];
  } catch {
    home = undefined;
  }

  if (home) {
    redirect(
      home.company_id
        ? `/crm/company/${home.company_id}/clients/${home.folder_id}/${home.project_id}/quotations/${home.id}`
        : `/crm/individual/${home.folder_id}/${home.project_id}/quotations/${home.id}`,
    );
  }

  // Fallback — project-less quotation with no CRM home. Render the read-only
  // viewer directly (the same component the CRM viewer uses).
  const appSettings = await getAppSettings();
  return (
    <div className="min-h-screen bg-magic-soft/40 print-root">
      <div className="no-print">
        <TopBar user={user} />
      </div>
      <main className="max-w-5xl mx-auto p-6 print-main">
        <QuotationViewer quotationId={quotationId} appSettings={appSettings} />
      </main>
    </div>
  );
}
