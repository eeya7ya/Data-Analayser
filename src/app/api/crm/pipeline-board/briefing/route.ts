import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireModuleAllowLegacy, hasModuleRole } from "@/lib/modules";
import { groqClient, DESIGN_MODEL } from "@/lib/groq";
import {
  type Stage,
  STAGE_LABEL,
  deriveStage,
  insight,
} from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 2 — AI pipeline briefing. ONE Groq call (not one per deal) over a
 * compact snapshot of the live, non-terminal deals returns a short prioritised
 * "what to focus on today" for the signed-in salesperson. The deterministic
 * stage + next-best-action signals from `@/lib/pipeline` are fed in as grounding
 * so the model reasons over real data rather than inventing it.
 *
 * Sales-only, same gate as the board: admin / viewer never reach it; a
 * sales_manager briefs on the whole team, a salesperson on their own deals.
 */

interface Row {
  id: number;
  ref: string;
  client_name: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  sales_outcome: string | null;
  transferred_at: string | null;
  project_status: string | null;
  total: string | null;
  age_days: number | null;
  cost_covered: string | null;
  sale_covered: string | null;
}

const OPEN_STAGES: Stage[] = ["quoting", "approved", "won", "held"];

export async function POST() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireModuleAllowLegacy(user, "crm");

    const isViewer = user.role === "viewer";
    const isManager = await hasModuleRole(user.id, "crm", "sales_manager");
    const isSales = isManager || (await hasModuleRole(user.id, "crm", "sales"));
    if (!isSales && !isViewer) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({
        briefing: null,
        error:
          "AI briefing is off — set GROQ_API_KEY in the environment to enable it.",
      });
    }

    const q = sql();
    // Tenant isolation — see the board route. Manager/viewer brief on their own
    // tenant's deals; a salesperson only their own. Fails closed.
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
      select q.id, q.ref, q.client_name,
             q.approved_at, q.rejected_at, q.sales_outcome, q.transferred_at,
             p.status as project_status,
             jsonb_as_object(q.totals_json)->>'total' as total,
             floor(extract(epoch from (now() - coalesce(
               q.sales_outcome_at, q.approved_at, q.updated_at, q.created_at
             ))) / 86400)::int as age_days,
             coalesce(m.cost_covered, 0) as cost_covered,
             coalesce(m.sale_covered, 0) as sale_covered
      from quotations q
      left join projects p on p.id = q.project_id
      left join lateral (
        select
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
      where q.deleted_at is null
        and q.parent_ref is null
        and q.owner_id = any(${ownerIds}::int[])
      order by coalesce(q.sales_outcome_at, q.approved_at, q.updated_at, q.created_at) desc
      limit 1000
    `) as Row[];

    // Keep only live, non-terminal deals; rank attention-first then by value so
    // the most urgent/valuable deals make it into the (token-bounded) snapshot.
    const deals = rows
      .map((r) => {
        const stage = deriveStage(r);
        const ageDays = Math.max(0, r.age_days ?? 0);
        const value = Number(r.total);
        const saleCovered = Number(r.sale_covered ?? 0) || 0;
        const costCovered = Number(r.cost_covered ?? 0) || 0;
        const marginPct =
          saleCovered > 0
            ? Math.round(((saleCovered - costCovered) / saleCovered) * 100)
            : null;
        return {
          ref: r.ref,
          client: r.client_name,
          stage,
          value: Number.isFinite(value) ? value : 0,
          ageDays,
          marginPct,
          ...insight(stage, ageDays),
        };
      })
      .filter((d) => OPEN_STAGES.includes(d.stage))
      .sort(
        (a, b) =>
          Number(b.attention) - Number(a.attention) || b.value - a.value,
      )
      .slice(0, 25);

    if (deals.length === 0) {
      return NextResponse.json({
        briefing: "No open deals in your pipeline right now — nothing to brief.",
      });
    }

    const snapshot = deals
      .map(
        (d) =>
          `- [${STAGE_LABEL[d.stage]}] ${d.ref}` +
          (d.client ? ` · ${d.client}` : "") +
          ` · value ${Math.round(d.value)}` +
          (d.marginPct !== null ? ` · ~${d.marginPct}% margin` : "") +
          ` · ${d.ageDays}d in stage` +
          (d.attention ? ` · NEEDS ATTENTION (${d.action})` : ` · ${d.action}`),
      )
      .join("\n");

    const groq = groqClient();
    const completion = await groq.chat.completions.create({
      model: DESIGN_MODEL(),
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are MagicTech's sales operations assistant for a low-current / " +
            "ICT / AV / security systems integrator. Given a snapshot of the " +
            "live sales pipeline, write a short, prioritised briefing: the 3–5 " +
            "highest-impact actions to take today, most urgent first. Reference " +
            "deal refs explicitly, weigh value AND margin against how long a " +
            "deal has stalled (a high-value but thin-margin deal may rank below " +
            "a smaller high-margin one), and be concrete. Margins are estimates " +
            "and may be missing on some deals. Output plain-text bullets only — " +
            "no preamble, no headings, no closing remarks.",
        },
        {
          role: "user",
          content: `Pipeline snapshot (${deals.length} open deals):\n${snapshot}`,
        },
      ],
    });

    const briefing =
      completion.choices[0]?.message?.content?.trim() ||
      "The assistant returned no briefing — try again.";

    return NextResponse.json({ briefing });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
