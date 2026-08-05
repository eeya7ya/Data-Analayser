import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy, hasModuleRole } from "@/lib/modules";
import { sweepDueHolds } from "@/lib/holds";
import {
  type Stage,
  collapseVersions,
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
 *
 * One card per quotation NUMBER, not per row. A Draft / Revision (`parent_ref`
 * set) that presales handed to sales walks the same cycle as the original, so
 * excluding every snapshot outright — as this board used to — left the card
 * frozen at "Quoting" while the salesperson actually won or lost the revision.
 * Instead we pull the original plus every snapshot that was sent to sales, then
 * collapse each lineage (`parent_ref ?? ref`) down to the version carrying the
 * latest decision — see pickLineageWinner. Never-sent private snapshots stay
 * out entirely. Non-admins see only their own quotations.
 */

interface DealRow {
  id: number;
  ref: string;
  /** Root quotation ref for a Draft / Revision; null on the original. */
  parent_ref: string | null;
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
  sent_to_sales_at: string | null;
  completed_at: string | null;
  project_status: string | null;
  totals_json: string | Record<string, unknown> | null;
  age_anchor: string | null;
}

/** BoQ total out of a quotation's totals_json (TEXT on D1, object on PG). */
function parseTotalJson(
  totals: string | Record<string, unknown> | null,
): number {
  if (totals == null) return 0;
  let obj: unknown = totals;
  if (typeof totals === "string") {
    try {
      obj = JSON.parse(totals);
    } catch {
      return 0;
    }
  }
  const t = Number((obj as { total?: unknown } | null)?.total);
  return Number.isFinite(t) ? t : 0;
}

/**
 * BoQ margin for one quotation, computed from its items_json. Mirrors the old
 * SQL exactly: over non-section, non-optional lines with a numeric unit_price,
 *   sale     = unit_price * quantity        (quantity 0 when non-numeric)
 *   has_cost = price_si is numeric
 *   cost     = has_cost ? price_si * quantity : 0
 * returning Σsale as the base, plus Σcost / Σsale over only the cost-covered
 * lines. Backend-agnostic: items_json is a JSON array on Postgres and JSON text
 * on D1. Done in JS because the old lateral SQL used `jsonb_array_elements` and
 * the `~` regex operator — neither exists on D1, so the board silently lost all
 * margin there.
 */
function computeMargin(itemsJson: string | unknown[] | null): MarginRow {
  let saleBase = 0;
  let costCovered = 0;
  let saleCovered = 0;
  for (const raw of parseItemsArray(itemsJson)) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    if (String(it.kind ?? "item") === "section") continue;
    if (String(it.optional ?? "") === "true") continue;
    const unit = numericLike(it.unit_price);
    if (unit === null) continue; // matches the SQL's unit_price numeric guard
    const qty = numericLike(it.quantity) ?? 0;
    const sale = unit * qty;
    const cost = numericLike(it.price_si);
    saleBase += sale;
    if (cost !== null) {
      costCovered += cost * qty;
      saleCovered += sale;
    }
  }
  return {
    sale_base: saleBase,
    cost_covered: costCovered,
    sale_covered: saleCovered,
  };
}

/** Coerce a quotation's items_json (array on PG, JSON text on D1) to an array. */
function parseItemsArray(itemsJson: string | unknown[] | null): unknown[] {
  let val: unknown = itemsJson;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      return [];
    }
  }
  return Array.isArray(val) ? val : [];
}

/**
 * Parse a value that looks exactly like `-?[0-9]+([.][0-9]+)?` — the same guard
 * the SQL applied via the `~` regex before ::numeric — else null, so a
 * malformed cell contributes nothing instead of erroring.
 */
function numericLike(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v.trim() : String(v);
  if (!/^-?[0-9]+([.][0-9]+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Whole days between an ISO/text timestamp and now (computed in JS for D1). */
function ageDaysFrom(anchor: string | null): number {
  if (!anchor) return 0;
  const t = new Date(anchor).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
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
  /** Markup % over the SI base (Σ(sale−SI)/ΣSI), or null. The SI base
   *  already includes margin, so 0% markup ≠ break-even — the UI shows this
   *  as "priced above SI base", never as profit-or-loss. */
  markupPct: number | null;
  /** Fraction (0–1) of the deal's line value that has cost data. */
  coverage: number;
}

interface MarginRow {
  sale_base: number;
  cost_covered: number;
  sale_covered: number;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    // Admin does NOT see the pipeline. The gate is a CRM sales grant, or the
    // read-only `viewer` role. Every sales user — plain salesperson OR
    // sales_manager — is scoped to the deals they OWN; a sales_manager does not
    // get to see other people's jobs. Cross-team oversight of the whole tenant
    // is the `viewer` role's job, not the manager's.
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

    // Tenant isolation: only the read-only `viewer` role sees every deal owned
    // by a user in THEIR tenant — never globally. Every sales user, manager
    // included, is scoped to THEIR deals. Crucially, "their deals" is not just
    // rows they own: quotations are owned by the presales author, and a
    // salesperson's whole book is what presales SENT them (sent_to_sales_to /
    // sales_accepted_by) plus quotations on projects whose RFQ they raised.
    // The previous owner-only filter made a plain salesperson's board
    // permanently empty — every KPI read 0.
    const tenantWide = isViewer;
    const ownerIds = tenantWide
      ? (
          (await q`
            select u2.id from users u2
            where u2.tenant_id is not distinct from
                  (select tenant_id from users where id = ${user.id})
          `) as Array<{ id: number }>
        ).map((r) => r.id)
      : [user.id];

    const allVersions = (await q`
      select q.id, q.ref, q.parent_ref, q.project_name, q.client_name, q.folder_id,
             q.project_id, q.owner_id,
             coalesce(nullif(u.display_name, ''), u.username) as owner_name,
             q.approved_at, q.rejected_at, q.sales_outcome, q.transferred_at,
             q.sent_to_sales_at, q.completed_at,
             p.status as project_status,
             q.totals_json as totals_json,
             coalesce(
               q.sales_outcome_at, q.approved_at, q.updated_at, q.created_at
             ) as age_anchor
      from quotations q
      left join projects p on p.id = q.project_id
      left join users u on u.id = q.owner_id
      where q.deleted_at is null
        -- Originals always; drafts / revisions only once presales actually
        -- handed them to sales (a private snapshot is not a deal).
        and (q.parent_ref is null or q.sent_to_sales_at is not null)
        and (
          q.owner_id = any(${ownerIds}::int[])
          or (${!tenantWide}::boolean and (
            q.sent_to_sales_to = ${user.id}
            or q.sales_accepted_by = ${user.id}
            or exists (
              select 1 from leads l
              where l.deleted_at is null
                and l.created_by = ${user.id}
                and (l.quotation_id = q.id
                     or (q.project_id is not null
                         and (l.project_id = q.project_id
                              or l.sales_project_id = q.project_id)))
            )
          ))
        )
      order by coalesce(q.sales_outcome_at, q.approved_at, q.updated_at, q.created_at) desc
      limit 1000
    `) as DealRow[];

    // One card per quotation number: every draft / revision folds into the
    // original's lineage so a deal is never counted twice, and the version the
    // sales side last acted on is the one that represents it.
    const rows = collapseVersions(allVersions);

    // Margin is fault-isolated so the heavier per-line BoQ math can never break
    // the core board. Each line stores `price_si` (the System-Installer / dealer
    // cost), so gross profit is Σ(unit_price − price_si)·qty over priced,
    // non-optional, non-section lines. Lines without a numeric price_si are
    // excluded and tracked as a coverage gap rather than silently assumed
    // zero-cost. Computed in JS (see computeMargin) so it works identically on
    // D1 and Postgres; malformed cells contribute nothing instead of erroring.
    const ids = rows.map((r) => r.id);
    const marginById = new Map<number, MarginRow>();
    if (ids.length > 0) {
      try {
        const itemRows = (await q`
          select id, items_json from quotations
          where id = any(${ids}::int[])
        `) as Array<{ id: number; items_json: string | unknown[] | null }>;
        for (const ir of itemRows) {
          marginById.set(ir.id, computeMargin(ir.items_json));
        }
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
          -- One decided row per quotation NUMBER: distinct on keeps the version
          -- whose decision landed last, so a lineage where the original was
          -- lost and a later revision won counts as a single win, not as one
          -- win + one loss.
          select distinct on (coalesce(q.parent_ref, q.ref))
                 q.client_name,
                 (q.sales_outcome in ('accepted', 'held')
                  or q.transferred_at is not null
                  or q.completed_at is not null) as won
          from quotations q
          where q.deleted_at is null
            and (q.sales_outcome in ('accepted', 'rejected', 'held')
                 or q.transferred_at is not null
                 or q.completed_at is not null)
            and (
              q.owner_id = any(${ownerIds}::int[])
              or (${!tenantWide}::boolean and (
                q.sent_to_sales_to = ${user.id}
                or q.sales_accepted_by = ${user.id}
              ))
            )
          order by coalesce(q.parent_ref, q.ref),
                   coalesce(q.sales_outcome_at, q.updated_at, q.created_at) desc
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
    let sumCostCovered = 0;
    let sumGrossProfit = 0;

    for (const r of rows) {
      const stage = deriveStage(r);
      const value = parseTotalJson(r.totals_json);
      const ageDays = ageDaysFrom(r.age_anchor);
      const { action, attention } = insight(stage, ageDays);

      const mr = marginById.get(r.id);
      const saleBase = Number(mr?.sale_base ?? 0) || 0;
      const saleCovered = Number(mr?.sale_covered ?? 0) || 0;
      const costCovered = Number(mr?.cost_covered ?? 0) || 0;
      const grossProfit = saleCovered - costCovered;
      const marginPct =
        saleCovered > 0 ? (grossProfit / saleCovered) * 100 : null;
      const dealMarkupPct =
        costCovered > 0 ? (grossProfit / costCovered) * 100 : null;
      const coverage = saleBase > 0 ? saleCovered / saleBase : 0;
      sumSaleBase += saleBase;
      sumSaleCovered += saleCovered;
      sumCostCovered += costCovered;
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
        markupPct: dealMarkupPct === null ? null : Math.round(dealMarkupPct),
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
    // Markup over the SI base — how far above the System-Installer price the
    // pipeline is sold. The SI base itself already carries a healthy margin,
    // so selling AT SI base (0% markup) is NOT a loss; the UI presents this
    // as "priced X% above SI base", never as profit-or-loss vs cost.
    const markupPct =
      sumCostCovered > 0
        ? Math.round((sumGrossProfit / sumCostCovered) * 100)
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
    // "Open" = presales hasn't finished them yet (completed_at gets stamped
    // when the quotation is sent to sales); counting every lead ever created
    // made the chip permanently overstate the funnel.
    let leadsOpen = 0;
    try {
      const leadRows = (await q`
        select count(*)::int as n from leads
        where deleted_at is null
          and completed_at is null
          and created_by = any(${tenantWide ? ownerIds : [user.id]}::int[])
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
        wonValue: sumValue(["won", "held", "execution", "delivered"]),
        weightedForecast: Math.round(weightedForecast),
        weightedGrossProfit: Math.round(weightedGrossProfit),
        blendedMarginPct,
        markupPct,
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
