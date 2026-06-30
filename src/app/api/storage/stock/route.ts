import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema, usingD1, rawBinder } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";
import { tokenize } from "@/lib/search";
import { isFtsReady, matchAll, ftsPredicate } from "@/lib/fts";

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
    const nodeRaw = url.searchParams.get("node_id");
    const nodeId =
      nodeRaw && Number.isInteger(Number(nodeRaw)) ? Number(nodeRaw) : null;
    const q = sql();

    // Items query: FTS5 product filter on D1 (was a full scan of products per
    // search), else the original vendor/model ILIKE. Built as raw SQL so the
    // predicate can be swapped without composing tagged-template fragments.
    const { P, params: itemParams } = rawBinder();
    const itemWhere: string[] = [];
    if (term !== "") {
      let hay: string | undefined;
      if (usingD1() && isFtsReady()) {
        const match = matchAll(tokenize(term));
        if (match) hay = ftsPredicate("products", "p.id", P(match));
      }
      if (!hay) {
        const like = `%${term}%`;
        hay = `(p.vendor ilike ${P(like)} or p.model ilike ${P(like)})`;
      }
      itemWhere.push(hay);
    }
    if (nodeId !== null) {
      itemWhere.push(
        `exists (select 1 from stock_placements x where x.item_id = p.id and x.node_id = ${P(nodeId)} and x.qty > 0)`,
      );
    }
    const itemWhereSql = itemWhere.length ? "where " + itemWhere.join(" and ") : "";
    const items = (await q.unsafe(
      `select p.id as item_id,
              coalesce(nullif(trim(p.vendor || ' ' || p.model), ''), p.model) as label,
              p.vendor, p.model,
              coalesce(s.reorder_point, 0) as reorder_point,
              coalesce(sum(pl.qty), 0)::int as total
       from products p
       left join stock_item_settings s on s.item_id = p.id
       left join stock_placements pl on pl.item_id = p.id
       ${itemWhereSql}
       group by p.id, s.reorder_point
       having coalesce(sum(pl.qty), 0) > 0 or s.reorder_point is not null
       order by label
       limit 500`,
      itemParams,
    )) as Array<Record<string, unknown>>;

    const { P: P2, params: placeParams } = rawBinder();
    const nodeClause = nodeId !== null ? `and pl.node_id = ${P2(nodeId)}` : "";
    const placements = (await q.unsafe(
      `select pl.item_id, pl.node_id, pl.qty,
              n.name as node_name
       from stock_placements pl
       join stock_location_nodes n on n.id = pl.node_id
       where pl.qty > 0
         ${nodeClause}
       order by n.name`,
      placeParams,
    )) as Array<Record<string, unknown>>;

    return NextResponse.json({ items, placements });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
