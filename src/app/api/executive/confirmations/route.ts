import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isExecutiveManager, hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Executive-manager confirmation workflow.
 *
 * Presales / presales managers SUBMIT a finished quotation (with pricing) or a
 * pricing sheet for sign-off; the executive manager CONFIRMS or REJECTS it.
 *
 *   GET  → the executive queue: pending + recently decided quotations and
 *          pricing sheets across every user. Executive manager / admin only.
 *   POST { type:'quotation'|'pricing', id, action:'submit'|'confirm'|'reject',
 *          reason? }
 *          - submit  → presales / presales_manager / admin (owner, or a
 *                      presales_manager / admin for any team item)
 *          - confirm / reject → executive_manager / admin
 *
 * The status ('none' → 'pending' → 'confirmed' | 'rejected') is a sign-off
 * record; it does not block the existing send-to-sales pipeline.
 */

type ItemType = "quotation" | "pricing";
const TABLE: Record<ItemType, string> = {
  quotation: "quotations",
  pricing: "pricing_projects",
};

export async function GET() {
  try {
    await ensureSchema();
    const user = await requireUser();
    if (!(await isExecutiveManager(user))) throw new Error("FORBIDDEN");
    const q = sql();

    const quotations = (await q`
      select qq.id, qq.ref, qq.project_name, qq.client_name,
             qq.exec_status, qq.exec_submitted_at, qq.exec_decided_at,
             qq.exec_reject_reason,
             sub.username as submitted_by, own.username as owner
      from quotations qq
      left join users sub on sub.id = qq.exec_submitted_by
      left join users own on own.id = qq.owner_id
      where qq.deleted_at is null and qq.exec_status <> 'none'
      order by qq.exec_status = 'pending' desc, qq.exec_submitted_at desc
      limit 100
    `) as Array<Record<string, unknown>>;

    const pricing = (await q`
      select pp.id, pp.name, m.name as manufacturer,
             pp.exec_status, pp.exec_submitted_at, pp.exec_decided_at,
             pp.exec_reject_reason,
             sub.username as submitted_by, own.username as owner
      from pricing_projects pp
      left join pricing_manufacturers m on m.id = pp.manufacturer_id
      left join users sub on sub.id = pp.exec_submitted_by
      left join users own on own.id = pp.user_id
      where pp.deleted_at is null and pp.exec_status <> 'none'
      order by pp.exec_status = 'pending' desc, pp.exec_submitted_at desc
      limit 100
    `) as Array<Record<string, unknown>>;

    const pendingCount =
      quotations.filter((r) => r.exec_status === "pending").length +
      pricing.filter((r) => r.exec_status === "pending").length;

    return NextResponse.json({ quotations, pricing, pendingCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as {
      type?: string;
      id?: number | string;
      action?: string;
      reason?: string;
    };
    const type = body.type as ItemType;
    if (type !== "quotation" && type !== "pricing") {
      return NextResponse.json({ error: "invalid type" }, { status: 400 });
    }
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const action = body.action;
    if (action !== "submit" && action !== "confirm" && action !== "reject") {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }

    const table = TABLE[type];
    const q = sql();

    // Confirm the row exists (and isn't deleted) before acting on it.
    const rows = (await q.unsafe(
      `select 1 as ok from ${table} where id = $1 and deleted_at is null`,
      [id],
    )) as Array<{ ok: number }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (action === "submit") {
      // Who may submit is role-specific and deliberately EXCLUDES admin:
      //   • a quotation is submitted to the executive by sales / sales managers
      //     (they own the deal — presales only prepare it),
      //   • a pricing sheet is submitted by presales managers.
      const allowed =
        type === "quotation"
          ? (await hasModuleRole(user.id, "crm", "sales")) ||
            (await hasModuleRole(user.id, "crm", "sales_manager"))
          : await hasModuleRole(user.id, "crm", "presales_manager");
      if (!allowed) throw new Error("FORBIDDEN");
      await q.unsafe(
        `update ${table}
           set exec_status = 'pending',
               exec_submitted_at = now(),
               exec_submitted_by = $1,
               exec_decided_at = null,
               exec_decided_by = null,
               exec_reject_reason = null
         where id = $2`,
        [user.id, id],
      );
      return NextResponse.json({ ok: true, exec_status: "pending" });
    }

    // confirm / reject — executive manager (or admin) only.
    if (!(await isExecutiveManager(user))) throw new Error("FORBIDDEN");
    const next = action === "confirm" ? "confirmed" : "rejected";
    const reason =
      action === "reject" ? (body.reason ?? "").toString().trim() : null;
    if (action === "reject" && !reason) {
      return NextResponse.json(
        { error: "a reason is required to reject" },
        { status: 400 },
      );
    }
    await q.unsafe(
      `update ${table}
         set exec_status = $1,
             exec_decided_at = now(),
             exec_decided_by = $2,
             exec_reject_reason = $3
       where id = $4`,
      [next, user.id, reason, id],
    );
    return NextResponse.json({ ok: true, exec_status: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
