/**
 * POST /api/admin/catalogue/regenerate-descriptions
 *
 * Body:
 *   { vendor?: string, ids?: number[], force?: boolean, limit?: number }
 *
 * Kicks off a background job using Next 15's `after()` so the request
 * returns immediately with `{ jobId }`. Progress is polled via
 * GET /api/admin/catalogue/jobs/:id which reads from `catalogue_jobs`.
 *
 * Skips rows with `description_locked = true` unless `force: true`.
 */
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import {
  generateDescriptionsBatch,
  DESCRIPTION_BATCH_SIZE,
  type CatalogueRowForLLM,
} from "@/lib/descriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  vendor?: string;
  ids?: number[];
  force?: boolean;
  limit?: number;
}

interface Row {
  id: number;
  vendor: string;
  category: string;
  sub_category: string | null;
  model: string;
  currency: string;
  price_dpp: number | string | null;
  price_si: number | string | null;
  specs: Record<string, unknown> | null;
}

function toRowForLLM(r: Row): CatalogueRowForLLM {
  return {
    id: r.id,
    vendor: r.vendor,
    category: r.category,
    sub_category: r.sub_category,
    model: r.model,
    currency: r.currency,
    price_dpp: r.price_dpp != null ? Number(r.price_dpp) : null,
    price_si: r.price_si != null ? Number(r.price_si) : null,
    specs: r.specs || {},
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    await ensureSchema();
    const body = (await req.json().catch(() => ({}))) as Body;
    const db = sql();

    // Figure out which rows need processing.
    const vendorFilter = body.vendor ? db`and vendor = ${body.vendor}` : db``;
    const idFilter =
      body.ids && body.ids.length > 0
        ? db`and id in ${db(body.ids)}`
        : db``;
    const lockFilter = body.force
      ? db``
      : db`and description_locked = false`;
    const emptyFilter =
      body.force || (body.ids && body.ids.length > 0)
        ? db``
        : db`and description = ''`;
    const limitClause = body.limit ? db`limit ${body.limit}` : db``;

    const targets = (await db`
      select id, vendor, category, sub_category, model, currency,
             price_dpp, price_si, specs
        from catalogue_items
       where active = true
         ${vendorFilter}
         ${idFilter}
         ${lockFilter}
         ${emptyFilter}
       order by id
       ${limitClause}
    `) as Row[];

    if (targets.length === 0) {
      return NextResponse.json({
        jobId: null,
        total: 0,
        message: "Nothing to regenerate.",
      });
    }

    const jobRows = (await db`
      insert into catalogue_jobs (kind, status, total, done, payload)
      values (
        'regenerate-descriptions',
        'pending',
        ${targets.length},
        0,
        ${JSON.stringify({
          vendor: body.vendor || null,
          force: !!body.force,
          ids: body.ids || null,
        })}::jsonb
      )
      returning id
    `) as Array<{ id: number }>;
    const jobId = jobRows[0].id;

    // Dispatch the long work into the background so the HTTP request can
    // return now. `after()` runs after the response is flushed.
    after(async () => {
      const job = sql();
      try {
        await job`
          update catalogue_jobs set status = 'running', updated_at = now()
            where id = ${jobId}
        `;
        let done = 0;
        for (let i = 0; i < targets.length; i += DESCRIPTION_BATCH_SIZE) {
          const batch = targets.slice(i, i + DESCRIPTION_BATCH_SIZE);
          try {
            const generated = await generateDescriptionsBatch(
              batch.map(toRowForLLM),
            );
            const byId = new Map(
              generated.map((g) => [g.id, g.description]),
            );
            for (const row of batch) {
              const desc = byId.get(row.id);
              if (!desc) continue;
              await job`select set_config('app.price_source', 'ai-regen', true)`;
              await job`
                update catalogue_items
                   set description = ${desc}
                 where id = ${row.id}
              `;
            }
            done += batch.length;
            await job`
              update catalogue_jobs
                 set done = ${done}, updated_at = now()
               where id = ${jobId}
            `;
          } catch (err) {
            console.error("regenerate batch failed:", err);
            // Keep going — one bad batch shouldn't kill the whole job.
          }
        }
        await job`
          update catalogue_jobs
             set status = 'done', done = ${done}, updated_at = now()
           where id = ${jobId}
        `;
      } catch (err) {
        await job`
          update catalogue_jobs
             set status = 'error',
                 error  = ${(err as Error).message || String(err)},
                 updated_at = now()
           where id = ${jobId}
        `;
      }
    });

    return NextResponse.json({ jobId, total: targets.length });
  } catch (err) {
    const msg = (err as Error).message || "error";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
