import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { canReadAll, requireUser } from "@/lib/auth";
import { hasModule } from "@/lib/modules";

export const runtime = "nodejs";

/**
 * Storage V1.5A — the stock event ledger (Features 1 + 5). The append-only
 * `stock_events` row is the source of truth; the `stock_placements` cache
 * is updated in the SAME transaction so a movement can never half-apply.
 *
 * One generic rule covers all four types: subtract `qty` from `from_node`
 * (if set) and add `qty` to `to_node` (if set).
 *   IN     → to only          OUT    → from only
 *   MOVE   → from + to         ADJUST → exactly one side (+ a reason)
 *
 * A decrement that would drive a placement negative is rejected (the
 * `qty >= qty` guard returns no row → the transaction rolls back), so stock
 * never goes below zero. POST is open to any storage worker / manager /
 * admin; GET (history) to any storage / admin reader.
 */

type EventType = "IN" | "OUT" | "MOVE" | "ADJUST";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!isAdmin && !(await hasModule(user.id, "storage"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = (await req.json()) as {
      item_id?: number;
      type?: string;
      qty?: number;
      from_node_id?: number | null;
      to_node_id?: number | null;
      reason?: string | null;
      method?: string;
    };

    const itemId = Number(body.item_id);
    const type = String(body.type ?? "") as EventType;
    const qty = Number(body.qty);
    const fromNode = body.from_node_id == null ? null : Number(body.from_node_id);
    const toNode = body.to_node_id == null ? null : Number(body.to_node_id);
    const reason = body.reason ? String(body.reason).trim() : null;
    // Only the two user-initiated methods are accepted from the client;
    // import / sync are server-side origins. Anything else falls back to manual.
    const method = body.method === "scan" ? "scan" : "manual";

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }
    if (!["IN", "OUT", "MOVE", "ADJUST"].includes(type)) {
      return NextResponse.json({ error: "invalid type" }, { status: 400 });
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return NextResponse.json(
        { error: "qty must be a whole number greater than 0" },
        { status: 400 },
      );
    }

    // Per-type node requirements.
    if (type === "IN" && (toNode == null || fromNode != null)) {
      return NextResponse.json(
        { error: "IN needs a destination node only" },
        { status: 400 },
      );
    }
    if (type === "OUT" && (fromNode == null || toNode != null)) {
      return NextResponse.json(
        { error: "OUT needs a source node only" },
        { status: 400 },
      );
    }
    if (type === "MOVE" && (fromNode == null || toNode == null || fromNode === toNode)) {
      return NextResponse.json(
        { error: "MOVE needs two different nodes" },
        { status: 400 },
      );
    }
    if (type === "ADJUST") {
      if ((fromNode == null) === (toNode == null)) {
        return NextResponse.json(
          { error: "ADJUST needs exactly one node (increase or decrease)" },
          { status: 400 },
        );
      }
      if (!reason) {
        return NextResponse.json(
          { error: "ADJUST requires a reason" },
          { status: 400 },
        );
      }
    }

    const q = sql();

    // Item + node existence / active checks.
    const item = (await q`select 1 from products where id = ${itemId} limit 1`) as Array<{
      "?column?": number;
    }>;
    if (item.length === 0) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    for (const nid of [fromNode, toNode]) {
      if (nid == null) continue;
      const n = (await q`
        select 1 from stock_location_nodes where id = ${nid} and deleted_at is null limit 1
      `) as Array<Record<string, unknown>>;
      if (n.length === 0) {
        return NextResponse.json(
          { error: "location not found or archived" },
          { status: 404 },
        );
      }
    }

    try {
      const event = await q.begin(async (tx) => {
        if (fromNode != null) {
          const dec = (await tx`
            update stock_placements
            set qty = qty - ${qty}, updated_at = now()
            where item_id = ${itemId} and node_id = ${fromNode} and qty >= ${qty}
            returning qty
          `) as Array<{ qty: number }>;
          if (dec.length === 0) throw new Error("INSUFFICIENT_STOCK");
        }
        if (toNode != null) {
          await tx`
            insert into stock_placements (item_id, node_id, qty)
            values (${itemId}, ${toNode}, ${qty})
            on conflict (item_id, node_id)
            do update set qty = stock_placements.qty + ${qty}, updated_at = now()
          `;
        }
        const ev = (await tx`
          insert into stock_events
            (item_id, type, qty, from_node_id, to_node_id, actor_id, method, reason)
          values
            (${itemId}, ${type}, ${qty}, ${fromNode}, ${toNode}, ${user.id}, ${method}, ${reason})
          returning id, event_uid, recorded_at
        `) as Array<Record<string, unknown>>;
        return ev[0];
      });

      // New live total + low-stock flag (summed from placements, never stored).
      const totals = (await q`
        select coalesce(sum(qty), 0)::int as total,
               coalesce((select reorder_point from stock_item_settings where item_id = ${itemId}), 0) as reorder_point
        from stock_placements where item_id = ${itemId}
      `) as Array<{ total: number; reorder_point: number }>;
      const total = totals[0]?.total ?? 0;
      const reorder = totals[0]?.reorder_point ?? 0;

      // Mirror a headline into the platform-wide activity feed (best-effort).
      try {
        await q`
          insert into syslog (actor_id, entity_type, entity_id, verb, meta_json)
          values (${user.id}, 'stock', ${itemId}, ${type.toLowerCase()},
                  ${JSON.stringify({ qty, from_node_id: fromNode, to_node_id: toNode })}::jsonb)
        `;
      } catch {
        // never fail a recorded movement because the audit headline didn't write
      }

      return NextResponse.json({
        event,
        total,
        reorder_point: reorder,
        low: reorder > 0 && total <= reorder,
      });
    } catch (txErr) {
      if ((txErr as Error).message === "INSUFFICIENT_STOCK") {
        return NextResponse.json(
          { error: "Not enough stock at the source location." },
          { status: 409 },
        );
      }
      throw txErr;
    }
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}

// GET /api/storage/events?item_id=…  → the item's movement history (newest first).
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    const isAdmin = canReadAll(user);
    if (!isAdmin && !(await hasModule(user.id, "storage"))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const itemId = Number(new URL(req.url).searchParams.get("item_id"));
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }
    const q = sql();
    const rows = (await q`
      select e.id, e.type, e.qty, e.from_node_id, e.to_node_id, e.reason,
             e.occurred_at, e.recorded_at,
             fn.name as from_node_name, tn.name as to_node_name,
             u.username as actor_username, u.display_name as actor_display_name
      from stock_events e
      left join stock_location_nodes fn on fn.id = e.from_node_id
      left join stock_location_nodes tn on tn.id = e.to_node_id
      left join users u on u.id = e.actor_id
      where e.item_id = ${itemId}
      order by e.recorded_at desc
      limit 100
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ events: rows });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "UNAUTHENTICATED" ? 401 : 500 },
    );
  }
}
