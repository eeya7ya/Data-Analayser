import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy, hasModuleRole } from "@/lib/modules";
import { sweepDueHolds } from "@/lib/holds";
import {
  type Stage,
  deriveStage,
  insight,
  winProbability,
} from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Quote-to-Delivery pipeline board.
 *
 * Unlike the simple Held/Won/Lost board (`/api/crm/pipeline`), this returns the
 * FULL lifecycle of every live quotation, bucketed into ordered stages and
 * priced with the quotation's real BoQ total (`totals_json.total`). The stage
 * is DERIVED from the existing workflow columns — it always reflects reality,
 * there is no separate "stage" field to drift out of sync:
 *
 *   quoting    → not yet approved (approved_at null, rejected_at null)
 *   approved   → signed off internally, with the client (no outcome yet)
 *   won        → client accepted (sales_outcome = accepted)
 *   held       → held for execution, awaiting handoff to projects
 *   execution  → transferred to projects, project not yet completed
 *   delivered  → transferred and the project is completed
 *   lost       → client rejected, or the quotation was rejected at sign-off
 *
 * Each stage carries a win probability used for the weighted forecast — the
 * headline number a generic CRM can't compute because it has no BoQ value.
 * Snapshots (revision copies, `parent_ref` set) are excluded so every deal is
 * counted once. Non-admins see only their own quotations.
 */

interface DealRow {
  id: number;
  ref: string;
  project_name: string | null;
  client_name: string | null;
  folder_id: number | null;
  project_id: number | null;
  owner_id: number | null;
  owner_name: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  sales_outcome: string | null;
  transferred_at: string | null;
  project_status: string | null;
  total: string | null;
  age_days: number | null;
}

interface DealCard {
  id: number;
  ref: string;
  projectName: string | null;
  clientName: string | null;
  ownerName: string | null;
  value: number;
  stage: Stage;
  probability: number;
  ageDays: number;
  action: string;
  attention: boolean;
  /** Dynamic win probability (0–1) — stage base adjusted per deal. */
  probabilityDrivers: string[];
  /** Estimated gross profit = Σ(unit_price − price_si)·qty over lines that
   *  carry a System-Installer cost. null-ish when no line has cost data. */
  grossProfit: number;
  /** Gross margin % over the cost-covered portion of the deal, or null. */
  marginPct: number | null;
  /** Fraction (0–1) of the deal's line value that has cost data. */
  coverage: number;
}

interface MarginRow {
  id: number;
  sale_base: string | null;
  cost_covered: string | null;
  sale_covered: string | null;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    // Admin does NOT see the pipeline. The gate is a CRM sales grant, or the
    // read-only `viewer` role. A sales_manager and a viewer both see the whole
    // team's deals; a plain salesperson is scoped to their own.
    const isViewer = user.role === "viewer";
    const isManager = await hasModuleRole(user.id, "crm", "sales_manager");
    const isSales = isManager || (await hasModuleRole(user.id, "crm", "sales"));
    if (!isSales && !isViewer) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const q = sql();
    // Opening the board also fires any overdue auto-transfers, exactly like the
    // simple pipeline page — so Held deals don't linger past their schedule.
    await sweepDueHolds(q);

    // Tenant isolation: a manager/viewer sees every deal owned by a user in
    // THEIR tenant — never globally — while a plain salesperson sees only their
    // own. `ownerIds` is the allow-list of owners; it always contains at least
    // the requester, so an empty result fails closed (sees nothing) rather than
    // leaking across tenants.
    const tenantWide = isManager || isViewer;
    const ownerIds = tenantWide
      ? (
          (await q`
            select u2.id from users u2
            where u2.tenant_id is not distinct from
                  (select tenant_id from users where id = ${user.id})
          `) as Array<{ id: number }>
        ).map((r) => r.id)
      : [user.id];

    const rows = (await q`
      select q.id, q.ref, q.project_name, q.client_name, q.folder_id,
             q.project_id, q.owner_id,
             coalesce(nullif(u.display_name, ''), u.username) as owner_name,
             q.approved_at, q.rejected_at, q.sales_outcome, q.transferred_at,
             p.status as project_status,
             jsonb_as_object(q.totals_json)->>'total' as total,
             floor(extract(epoch from (now() - coalesce(
               q.sales_outcome_at, q.approved_at, q.updated_at, q.created_at
             ))) / 86400)::int as age_days
      from quotations q
      left join projects p on p.id = q.project_id
      left join users u on u.id = q.owner_id
      where q.deleted_at is null
        and q.parent_ref is null
        and q.owner_id = any(${ownerIds}::int[])
      order by coalesce(q.sales_outcome_at, q.approved_at, q.updated_at, q.created_at) desc
      limit 1000
    `) as DealRow[];

    // Margin is computed in a SEPARATE, fault-isolated query so the heavier
    // per-line jsonb math can never break the core board. Each BoQ line stores
    // `price_si` (the System-Installer / dealer cost), so gross profit is
    // Σ(unit_price − price_si)·qty over priced, non-optional, non-section lines.
    // Lines without a numeric price_si are excluded and tracked as a coverage
    // gap rather than silently assumed zero-cost. All casts are regex-guarded
    // so malformed cells contribute nothing instead of erroring.
    const ids = rows.map((r) => r.id);
    const marginById = new Map<number, MarginRow>();
    if (ids.length > 0) {
      try {
        const marginRows = (await q`
          select q.id,
                 coalesce(m.sale_base, 0)    as sale_base,
                 coalesce(m.cost_covered, 0) as cost_covered,
                 coalesce(m.sale_covered, 0) as sale_covered
          from quotations q
          left join lateral (
            select
              sum(li.sale)                                       as sale_base,
              sum(case when li.has_cost then li.cost else 0 end) as cost_covered,
              sum(case when li.has_cost then li.sale else 0 end) as sale_covered
            from (
              select
                (it->>'unit_price')::numeric * li_qty.qty as sale,
                case when (it->>'price_si') ~ '^-?[0-9]+([.][0-9]+)?$'
                     then (it->>'price_si')::numeric * li_qty.qty
                     else 0 end as cost,
                ((it->>'price_si') ~ '^-?[0-9]+([.][0-9]+)?$') as has_cost
              from jsonb_array_elements(jsonb_as_array(q.items_json)) as it
              cross join lateral (
                select case when (it->>'quantity') ~ '^-?[0-9]+([.][0-9]+)?$'
                            then (it->>'quantity')::numeric else 0 end as qty
              ) li_qty
              where coalesce(it->>'kind', 'item') <> 'section'
                and coalesce(it->>'optional', '') <> 'true'
                and (it->>'unit_price') ~ '^-?[0-9]+([.][0-9]+)?$'
            ) li
          ) m on true
          where q.id = any(${ids}::int[])
        `) as MarginRow[];
        for (const mr of marginRows) marginById.set(mr.id, mr);
      } catch {
        // Margin stays unavailable; the board still renders revenue-only.
      }
    }

    // Phase 4 — historical win rates per client (and the overall baseline) feed
    // the dynamic win-probability model. A deal is "won" if accepted/held or
    // already transferred to projects; "decided" adds rejected. Same scope as
    // the board. Fault-isolated: on failure, probability falls back to the
    // static stage base.
    const clientHistory = new Map<string, { decided: number; won: number }>();
    let baselineWinRate: number | null = null;
    try {
      const histRows = (await q`
        select coalesce(nullif(trim(client_name), ''), '∅') as client,
               count(*)::int as decided,
               count(*) filter (where won)::int as won
        from (
          select client_name,
                 (sales_outcome in ('accepted', 'held') or transferred_at is not null) as won
          from quotations
          where deleted_at is null
            and parent_ref is null
            and (sales_outcome in ('accepted', 'rejected', 'held') or transferred_at is not null)
            and owner_id = any(${ownerIds}::int[])
        ) t
        group by 1
      `) as Array<{ client: string; decided: number; won: number }>;
      let totDecided = 0;
      let totWon = 0;
      for (const h of histRows) {
        clientHistory.set(h.client, { decided: h.decided, won: h.won });
        totDecided += h.decided;
        totWon += h.won;
      }
      baselineWinRate = totDecided > 0 ? totWon / totDecided : null;
    } catch {
      // Probability falls back to the static stage base.
    }

    const columns: Record<Stage, DealCard[]> = {
      quoting: [],
      approved: [],
      won: [],
      held: [],
      execution: [],
      delivered: [],
      lost: [],
    };

    // Running totals for the blended-margin and coverage headline numbers.
    let sumSaleBase = 0;
    let sumSaleCovered = 0;
    let sumGrossProfit = 0;

    for (const r of rows) {
      const stage = deriveStage(r);
      const value = Number(r.total);
      const ageDays = Math.max(0, r.age_days ?? 0);
      const { action, attention } = insight(stage, ageDays);

      const mr = marginById.get(r.id);
      const saleBase = Number(mr?.sale_base ?? 0) || 0;
      const saleCovered = Number(mr?.sale_covered ?? 0) || 0;
      const costCovered = Number(mr?.cost_covered ?? 0) || 0;
      const grossProfit = saleCovered - costCovered;
      const marginPct =
        saleCovered > 0 ? (grossProfit / saleCovered) * 100 : null;
      const coverage = saleBase > 0 ? saleCovered / saleBase : 0;
      sumSaleBase += saleBase;
      sumSaleCovered += saleCovered;
      sumGrossProfit += grossProfit;

      // Dynamic win probability from stall decay + this client's track record.
      const ckey =
        r.client_name && r.client_name.trim() ? r.client_name.trim() : "∅";
      const ch = clientHistory.get(ckey);
      const clientWinRate =
        ch && ch.decided > 0 ? ch.won / ch.decided : null;
      const { p, drivers } = winProbability(stage, ageDays, {
        clientWinRate,
        baselineWinRate,
        clientSample: ch?.decided ?? 0,
      });

      columns[stage].push({
        id: r.id,
        ref: r.ref,
        projectName: r.project_name,
        clientName: r.client_name,
        ownerName: r.owner_name,
        value: Number.isFinite(value) ? value : 0,
        stage,
        probability: p,
        probabilityDrivers: drivers,
        ageDays,
        action,
        attention,
        grossProfit,
        marginPct: marginPct === null ? null : Math.round(marginPct),
        coverage,
      });
    }

    const sumValue = (stages: Stage[]) =>
      stages.reduce(
        (acc, s) => acc + columns[s].reduce((a, c) => a + c.value, 0),
        0,
      );

    const NON_TERMINAL: Stage[] = [
      "quoting",
      "approved",
      "won",
      "held",
      "execution",
    ];

    // Weighted forecast over every non-terminal deal: Σ(BoQ value × dynamic
    // win probability) — each deal weighted by its own AI-scored probability.
    const weightedForecast = NON_TERMINAL.reduce(
      (acc, s) =>
        acc + columns[s].reduce((a, c) => a + c.value * c.probability, 0),
      0,
    );

    // The headline margin number: Σ(estimated gross profit × probability) over
    // every non-terminal deal — gross profit forecast no generic CRM can show.
    const weightedGrossProfit = NON_TERMINAL.reduce(
      (acc, s) =>
        acc + columns[s].reduce((a, c) => a + c.grossProfit * c.probability, 0),
      0,
    );

    // Blended margin % across the cost-covered value, plus how much of the
    // priced pipeline actually has cost data (so the number is never oversold).
    const blendedMarginPct =
      sumSaleCovered > 0
        ? Math.round((sumGrossProfit / sumSaleCovered) * 100)
        : null;
    const marginCoverage =
      sumSaleBase > 0 ? Math.round((sumSaleCovered / sumSaleBase) * 100) : null;

    const counts = Object.fromEntries(
      (Object.keys(columns) as Stage[]).map((s) => [s, columns[s].length]),
    ) as Record<Stage, number>;

    // Simple win rate over decided deals (won/held/execution/delivered vs lost).
    const wonCount =
      counts.won + counts.held + counts.execution + counts.delivered;
    const decided = wonCount + counts.lost;
    const winRate = decided > 0 ? Math.round((wonCount / decided) * 100) : null;

    const attentionCount = (Object.keys(columns) as Stage[]).reduce(
      (acc, s) => acc + columns[s].filter((c) => c.attention).length,
      0,
    );

    // Open leads aren't priced (no BoQ yet) — surface them as a count chip so
    // the board still shows the top of the funnel without faking a value.
    let leadsOpen = 0;
    try {
      const leadRows = (await q`
        select count(*)::int as n from leads
        where deleted_at is null
          and created_by = any(${ownerIds}::int[])
      `) as Array<{ n: number }>;
      leadsOpen = Number(leadRows[0]?.n ?? 0);
    } catch {
      leadsOpen = 0; // leads table/column shape varies across deployments
    }

    return NextResponse.json({
      columns,
      counts,
      metrics: {
        openValue: sumValue(["quoting", "approved"]),
        committedValue: sumValue(["won", "held"]),
        deliveryValue: sumValue(["execution", "delivered"]),
        weightedForecast: Math.round(weightedForecast),
        weightedGrossProfit: Math.round(weightedGrossProfit),
        blendedMarginPct,
        marginCoverage,
        winRate,
        leadsOpen,
        attentionCount,
        totalDeals: rows.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
