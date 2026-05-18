import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consolidated notification feed for the TopBar bell. Anything that
 * used to live as a banner taped to a CRM page surfaces here instead
 * so the pages stay quiet and the user has one place to triage:
 *
 *   • Pending quotation approvals (sales/presales managers + admin)
 *   • Client folders marked `kind=company` but with no company_id
 *     (admin sees all; everyone else sees only the ones they own)
 *   • Folders still un-classified (admin only — they're the only ones
 *     who can resolve from /admin)
 *
 * The shape is intentionally generic — `{ id, severity, title, body,
 * action, secondary }` — so adding new sources later doesn't require
 * touching the bell UI.
 */

export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationItem {
  id: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  action?: { label: string; href: string };
  secondary?: { label: string; href: string };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ items: [] as NotificationItem[] });
  }
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const isSales =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
  const isPresales =
    isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));

  const q = sql();
  const items: NotificationItem[] = [];

  if (isSales || isPresales) {
    const approvalRows = (await q`
      select count(*)::int as n from quotations
      where deleted_at is null
        and approved_at is null
        and rejected_at is null
        and (
          (${isSales}::boolean and sales_approved_at is null)
          or (${isPresales}::boolean and presales_approved_at is null)
        )
    `) as Array<{ n: number }>;
    const pending = approvalRows[0]?.n ?? 0;
    if (pending > 0) {
      items.push({
        id: "approvals.pending",
        severity: "critical",
        title: `${pending} quotation${pending === 1 ? "" : "s"} need your approval`,
        body: "Open the inbox to review and sign off.",
        action: { label: "Open inbox", href: "/inbox/approvals" },
      });
    }
  }

  const ownerFilter = isAdmin ? null : user.id;

  const unattachedRows = (await q`
    select count(*)::int as n from client_folders
    where deleted_at is null
      and kind = 'company'
      and company_id is null
      and (${ownerFilter}::int is null or owner_id = ${ownerFilter})
  `) as Array<{ n: number }>;
  const unattached = unattachedRows[0]?.n ?? 0;
  if (unattached > 0) {
    items.push({
      id: "folders.unattached_company",
      severity: "warning",
      title: `${unattached} client folder${unattached === 1 ? "" : "s"} marked company but not attached to one`,
      body: "They keep working, they just don't show up under any company yet. Attach them by opening the folder and picking a company.",
      action: { label: "Open unattached", href: "/crm/unclassified" },
      secondary: isAdmin
        ? { label: "Admin → Folders quarantine", href: "/admin" }
        : undefined,
    });
  }

  if (isAdmin) {
    const unclassifiedRows = (await q`
      select count(*)::int as n from client_folders
      where deleted_at is null and kind is null
    `) as Array<{ n: number }>;
    const unclassified = unclassifiedRows[0]?.n ?? 0;
    if (unclassified > 0) {
      items.push({
        id: "folders.unclassified",
        severity: "warning",
        title: `${unclassified} folder${unclassified === 1 ? "" : "s"} need classification`,
        body: "Pre-V2 folders that haven't been marked Company / Individual yet. Pick a path to clear them.",
        action: { label: "View unclassified", href: "/crm/unclassified" },
        secondary: { label: "Admin → Folders", href: "/admin" },
      });
    }
  }

  return NextResponse.json({ items });
}
