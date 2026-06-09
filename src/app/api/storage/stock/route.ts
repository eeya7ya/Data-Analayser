import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";

/**
 * Storage V1.5A — live stock levels (Features 1 + 4 + 7). Returns, for
 * every item that currently has stock or a reorder point:
 *   - the item total (SUMMED from its placements — never a stored total),
 *   - its reorder point + a low-stock flag, and
 *   - the per-node placement breakdown.
 * Read-only; open to any storage / admin user. Optional filters:
 *   ?q= (vendor/model search)  ?node_id= (only items present at that node).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!isAdmin && !(await hasModule(user.id, "storage"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const url = new URL(req.url);
    const term = (url.searchParams.get("q") || "").trim();
    const like = `%${term}%`;
    const nodeRaw = url.searchParams.get("node_id");
    const nodeId =
      nodeRaw && Number.isInteger(Number(nodeRaw)) ? Number(nodeRaw) : null;
    const q = sql();

    const items = (await q`
      select p.id as item_id,
             coalesce(nullif(trim(p.vendor || ' ' || p.model), ''), p.model) as label,
             p.vendor, p.model,
             coalesce(s.reorder_point, 0) as reorder_point,
             coalesce(sum(pl.qty), 0)::int as total
      from products p
      left join stock_item_settings s on s.item_id = p.id
      left join stock_placements pl on pl.item_id = p.id
      where (${term === ""}::boolean or p.vendor ilike ${like} or p.model ilike ${like})
        and (
          ${nodeId}::int is null
          or exists (
            select 1 from stock_placements x
            where x.item_id = p.id and x.node_id = ${nodeId} and x.qty > 0
          )
        )
      group by p.id, s.reorder_point
      having coalesce(sum(pl.qty), 0) > 0 or s.reorder_point is not null
      order by label
      limit 500
    `) as Array<Record<string, unknown>>;

    const placements = (await q`
      select pl.item_id, pl.node_id, pl.qty,
             n.name as node_name
      from stock_placements pl
      join stock_location_nodes n on n.id = pl.node_id
      where pl.qty > 0
        and (${nodeId}::int is null or pl.node_id = ${nodeId})
      order by n.name
    `) as Array<Record<string, unknown>>;

    return NextResponse.json({ items, placements });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
