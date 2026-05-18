import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";

/**
 * Snapshot fields we copy out of `quotations.items_json` when the
 * requester fires a stock check. We deliberately drop the price /
 * delivery / picture fields — the storage team only needs to know
 * what to look for on the shelf, not how much it costs.
 */
interface SnapshotItem {
  no: number;
  system: string;
  brand: string;
  model: string;
  description: string;
  quantity: number;
}

interface RawItem {
  no?: unknown;
  system?: unknown;
  brand?: unknown;
  model?: unknown;
  description?: unknown;
  quantity?: unknown;
}

function snapshotFromItems(raw: unknown): SnapshotItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SnapshotItem[] = [];
  for (const r of raw as RawItem[]) {
    const qty = Number(r.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const brand = String(r.brand ?? "").trim();
    const model = String(r.model ?? "").trim();
    const description = String(r.description ?? "").trim();
    // Skip placeholder/empty lines so the storage checklist doesn't
    // include "row 5: nothing here, qty 0".
    if (!brand && !model && !description) continue;
    out.push({
      no: Number.isFinite(Number(r.no)) ? Number(r.no) : out.length + 1,
      system: String(r.system ?? "").trim(),
      brand,
      model,
      description,
      quantity: qty,
    });
  }
  return out;
}

interface StockCheckRow {
  id: number;
  quotation_id: number;
  status: "pending" | "answered" | "cancelled";
  requested_by: number;
  answered_by: number | null;
  created_at: string;
  answered_at: string | null;
}

/**
 * GET /api/stock-checks?status=pending  (storage / admin team inbox)
 *
 * Lists checks the caller is allowed to see. Members of the storage
 * module (and admins / viewers) see every check; everyone else only
 * sees rows they themselves requested. The default `status=pending`
 * matches the storage worker's "what's in my queue" use case; pass
 * `status=all` to get every status (handy for an audit view).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") || "pending";
    const isAdmin = canReadAll(user);
    const isStorage = isAdmin || (await hasModule(user.id, "storage"));
    const q = sql();

    const statusFilter =
      status === "all"
        ? null
        : status === "pending" || status === "answered" || status === "cancelled"
          ? status
          : "pending";

    const quotationIdRaw = url.searchParams.get("quotation_id");
    const quotationFilter =
      quotationIdRaw && Number.isFinite(Number(quotationIdRaw))
        ? Number(quotationIdRaw)
        : null;

    const rows = (await q`
      select c.id, c.quotation_id, c.status, c.requested_by,
             c.answered_by, c.created_at, c.answered_at,
             c.items_json, c.reply_json, c.storage_notes,
             qq.ref as quotation_ref,
             qq.project_name, qq.client_name,
             ru.username as requested_by_username,
             ru.display_name as requested_by_display_name,
             au.username as answered_by_username,
             au.display_name as answered_by_display_name
      from quotation_stock_checks c
      join quotations qq on qq.id = c.quotation_id
      left join users ru on ru.id = c.requested_by
      left join users au on au.id = c.answered_by
      where qq.deleted_at is null
        and (${statusFilter}::text is null or c.status = ${statusFilter})
        and (${quotationFilter}::int is null or c.quotation_id = ${quotationFilter})
        and (
          ${isStorage}::boolean
          or c.requested_by = ${user.id}
        )
      order by c.created_at desc
      limit 200
    `) as Array<Record<string, unknown>>;

    return NextResponse.json({ checks: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

/**
 * POST /api/stock-checks  body: { quotation_id }
 *
 * Snapshots the quotation's items into a new pending check. Only the
 * quotation owner (or an admin) can fire one. The partial unique
 * index on `quotation_id where status='pending'` is the actual race
 * shield — we also pre-check it here so the client gets a clean 409
 * instead of a constraint error string.
 *
 * Viewers are blocked by the global mutation middleware.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const body = (await req.json()) as { quotation_id?: number };
    const quotationId = Number(body.quotation_id);
    if (!Number.isFinite(quotationId) || quotationId <= 0) {
      return NextResponse.json(
        { error: "quotation_id is required" },
        { status: 400 },
      );
    }
    const q = sql();
    const isAdmin = canReadAll(user);

    const rows = (await q`
      select id, owner_id, items_json, ref, deleted_at
      from quotations
      where id = ${quotationId}
      limit 1
    `) as Array<{
      id: number;
      owner_id: number | null;
      items_json: unknown;
      ref: string;
      deleted_at: string | null;
    }>;
    if (rows.length === 0 || rows[0].deleted_at) {
      return NextResponse.json({ error: "quotation not found" }, { status: 404 });
    }
    const quotation = rows[0];
    if (!isAdmin && quotation.owner_id !== user.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const snapshot = snapshotFromItems(quotation.items_json);
    if (snapshot.length === 0) {
      return NextResponse.json(
        { error: "this quotation has no items to check" },
        { status: 400 },
      );
    }

    const open = (await q`
      select id from quotation_stock_checks
      where quotation_id = ${quotationId} and status = 'pending'
      limit 1
    `) as Array<{ id: number }>;
    if (open.length > 0) {
      return NextResponse.json(
        {
          error: "A stock check is already pending for this quotation.",
          existing_id: open[0].id,
        },
        { status: 409 },
      );
    }

    const inserted = (await q`
      insert into quotation_stock_checks
        (quotation_id, requested_by, status, items_json)
      values
        (${quotationId}, ${user.id}, 'pending', ${JSON.stringify(snapshot)}::jsonb)
      returning id, quotation_id, status, created_at
    `) as StockCheckRow[];

    return NextResponse.json({ check: inserted[0] }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
