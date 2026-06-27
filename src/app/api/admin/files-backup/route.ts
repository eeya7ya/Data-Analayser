import { NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isR2Configured, r2PresignDownloadUrl } from "@/lib/file-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/files-backup
 *
 * Returns the MANIFEST for a files backup — NOT the bytes. For every uploaded
 * file it gives the target path inside the ZIP and a short-lived presigned R2
 * GET URL. The browser then downloads each file straight from Cloudflare R2 and
 * assembles the ZIP locally (see FilesBackupPanel in AdminTabs.tsx).
 *
 * Why the browser does the assembly
 * ─────────────────────────────────
 * A Vercel serverless function can't be the pipe for every file: a buffered
 * response is capped at ~4.5 MB, the function is killed at 60 s, and holding
 * every file in memory risks an OOM. Routing the bytes through it is exactly
 * what produced net::ERR_FAILED. The app already moves files browser↔R2
 * directly (uploads PUT to a presigned R2 URL); this mirrors that for download.
 * The response here is tiny (just paths + URLs), so it can't hit any of those
 * limits.
 *
 * The browser fetches the presigned URLs cross-origin, so the R2 bucket's CORS
 * policy must allow GET from the app origin (the same policy that already
 * allows PUT for uploads — see .env.example).
 *
 * The response also carries the data the browser needs to add the two things
 * that are NOT uploaded files but still belong in the backup:
 *   - designed quotations  → `quotations[]` (id + ref + folder/project), which
 *     the browser renders to PDF under <Client>/<Project>/Quotations/.
 *   - the pricing module    → `pricing.manufacturers[]` (projects, constants,
 *     priced lines), which the browser writes to an .xlsx per manufacturer
 *     under Pricing/.
 *
 * Layout (computed here, deduped so nothing collides in the archive):
 *   <Client folder>/<Project>/<Quotations|Purchase Orders|BOQs|Other>/<filename>
 *
 * Admin only. Read-only on the database.
 */
export async function GET() {
  try {
    await requireAdmin();
    await ensureSchema();

    if (!isR2Configured()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "File storage (Cloudflare R2) is not configured on the server. " +
            "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID and " +
            "CLOUDFLARE_R2_SECRET_ACCESS_KEY.",
        },
        { status: 503 },
      );
    }

    const q = sql();

    // Every live file, with the human-readable folder + project names that
    // define its place in the tree. folder_id is NOT NULL on projects, but we
    // coalesce defensively so a file is never dropped over a missing name.
    const files = (await q`
      select pf.id, pf.kind, pf.filename, pf.size_bytes, pf.storage_path,
             coalesce(nullif(p.name, ''), 'Project ' || p.id::text)  as project_name,
             coalesce(nullif(cf.name, ''), 'Unfiled')                as folder_name
      from project_files pf
      join projects p on p.id = pf.project_id
      left join client_folders cf on cf.id = p.folder_id
      where pf.deleted_at is null and p.deleted_at is null
      order by folder_name, project_name, pf.kind, pf.id
    `) as Array<{
      id: number;
      kind: string;
      filename: string;
      size_bytes: number;
      storage_path: string;
      project_name: string;
      folder_name: string;
    }>;

    const usedPaths = new Set<string>();
    let totalBytes = 0;

    const items = files.map((f) => {
      const dir = `${safeSegment(f.folder_name)}/${safeSegment(f.project_name)}/${kindFolder(f.kind)}`;
      const zipPath = uniquePath(usedPaths, dir, f.filename, f.id);
      totalBytes += Number(f.size_bytes) || 0;
      return {
        id: f.id,
        folder: f.folder_name,
        project: f.project_name,
        kind: f.kind,
        filename: f.filename,
        zipPath,
        sizeBytes: Number(f.size_bytes) || 0,
        // 2-hour window: plenty of time for the browser to pull every file
        // even on a large backup over a slow connection.
        url: r2PresignDownloadUrl(f.storage_path, { expiresSeconds: 7200 }),
      };
    });

    // ── Designed quotations (DB rows, not files) ─────────────────────────────
    // Just the index the browser needs to render each one to PDF; the heavy
    // rendering happens client-side via /quotation?id=<n>.
    const quotations = (await q`
      select q.id, q.ref,
             coalesce(nullif(cf.name, ''), nullif(q.client_name, ''), 'Unfiled') as folder,
             coalesce(nullif(p.name, ''), 'General') as project
      from quotations q
      left join client_folders cf on cf.id = q.folder_id
      left join projects p on p.id = q.project_id
      where q.deleted_at is null
      order by folder, project, q.ref
    `) as Array<{ id: number; ref: string; folder: string; project: string }>;

    // ── Pricing module ───────────────────────────────────────────────────────
    const pricing = await collectPricing(q);

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      count: items.length,
      totalBytes,
      files: items,
      quotations,
      pricing,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "FORBIDDEN" ? 403 : msg === "UNAUTHENTICATED" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

// ─── pricing collection ──────────────────────────────────────────────────────

type SqlClient = ReturnType<typeof sql>;

type PricingLine = {
  position: number;
  itemModel: string;
  priceUsd: string;
  quantity: number;
  shippingOverride: string | null;
  customsOverride: string | null;
  shippingRateOverride: string | null;
  customsRateOverride: string | null;
  profitRateOverride: string | null;
};
type PricingConstants = {
  currencyRate: string;
  shippingRate: string;
  customsRate: string;
  profitMargin: string;
  taxRate: string;
  targetCurrency: string;
  sourceCurrency: string;
};
type PricingProject = {
  id: number;
  name: string;
  date: string | null;
  responsiblePerson: string | null;
  createdAt: string;
  constants: PricingConstants | null;
  productLines: PricingLine[];
};
type PricingManufacturer = {
  id: number;
  name: string;
  projects: PricingProject[];
};

/**
 * Read the whole pricing module into a nested manufacturer → project → lines
 * shape (mirrors /api/pricing/manufacturers/[id]/backup, but for everyone).
 * The browser turns each manufacturer into one .xlsx.
 */
async function collectPricing(
  q: SqlClient,
): Promise<{ manufacturers: PricingManufacturer[] }> {
  const mfgs = (await q`
    select id, name from pricing_manufacturers
    where deleted_at is null order by name
  `) as Array<{ id: number; name: string }>;

  const projects = (await q`
    select id, manufacturer_id, name, date, responsible_person, created_at
    from pricing_projects
    where deleted_at is null
    order by manufacturer_id, created_at asc
  `) as Array<{
    id: number;
    manufacturer_id: number;
    name: string;
    date: string | null;
    responsible_person: string | null;
    created_at: string;
  }>;

  const projectIds = projects.map((p) => p.id);

  const constants = (await q`
    select project_id, currency_rate, shipping_rate, customs_rate,
           profit_margin, tax_rate, target_currency, source_currency
    from pricing_project_constants
    where project_id = any(${projectIds}::bigint[])
  `) as Array<Record<string, unknown>>;
  const constByProject = new Map<number, PricingConstants>();
  for (const c of constants) {
    constByProject.set(Number(c.project_id), {
      currencyRate: String(c.currency_rate),
      shippingRate: String(c.shipping_rate),
      customsRate: String(c.customs_rate),
      profitMargin: String(c.profit_margin),
      taxRate: String(c.tax_rate),
      targetCurrency: String(c.target_currency),
      sourceCurrency: String(c.source_currency),
    });
  }

  const lines = (await q`
    select project_id, position, item_model, price_usd, quantity,
           shipping_override, customs_override,
           shipping_rate_override, customs_rate_override, profit_rate_override
    from pricing_product_lines
    where project_id = any(${projectIds}::bigint[])
    order by project_id asc, position asc
  `) as Array<Record<string, unknown>>;
  const linesByProject = new Map<number, PricingLine[]>();
  for (const l of lines) {
    const pid = Number(l.project_id);
    const arr = linesByProject.get(pid) ?? [];
    arr.push({
      position: Number(l.position),
      itemModel: (l.item_model as string) ?? "",
      priceUsd: String(l.price_usd),
      quantity: Number(l.quantity),
      shippingOverride: l.shipping_override != null ? String(l.shipping_override) : null,
      customsOverride: l.customs_override != null ? String(l.customs_override) : null,
      shippingRateOverride:
        l.shipping_rate_override != null ? String(l.shipping_rate_override) : null,
      customsRateOverride:
        l.customs_rate_override != null ? String(l.customs_rate_override) : null,
      profitRateOverride:
        l.profit_rate_override != null ? String(l.profit_rate_override) : null,
    });
    linesByProject.set(pid, arr);
  }

  const projByMfg = new Map<number, PricingProject[]>();
  for (const p of projects) {
    const arr = projByMfg.get(p.manufacturer_id) ?? [];
    arr.push({
      id: p.id,
      name: p.name,
      date: p.date,
      responsiblePerson: p.responsible_person,
      createdAt: p.created_at,
      constants: constByProject.get(p.id) ?? null,
      productLines: linesByProject.get(p.id) ?? [],
    });
    projByMfg.set(p.manufacturer_id, arr);
  }

  return {
    manufacturers: mfgs.map((m) => ({
      id: m.id,
      name: m.name,
      projects: projByMfg.get(m.id) ?? [],
    })),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Friendly sub-folder name per file kind, mirroring the Files-panel tabs. */
function kindFolder(kind: string): string {
  switch (kind) {
    case "quotation":
      return "Quotations";
    case "po":
      return "Purchase Orders";
    case "boq":
      return "BOQs";
    default:
      return "Other";
  }
}

/**
 * Make a folder / project name safe to use as a single path segment on any OS:
 * strip path separators and the characters Windows forbids, collapse
 * whitespace, and trim leading/trailing dots and spaces (which Windows also
 * rejects). Falls back to a placeholder so a path segment is never empty.
 */
function safeSegment(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/[/\\:*?"<>|]/g, "_") // path separators + Windows-forbidden chars
    .replace(/\s+/g, " ") // collapse runs of whitespace to single spaces
    .replace(/^[.\s]+|[.\s]+$/g, "") // trim leading/trailing dots & spaces
    .slice(0, 120);
  return cleaned || "Unnamed";
}

/**
 * Build a collision-free zip path for a file inside `dir`. The original
 * filename is preserved; on a clash within the same directory the file id is
 * inserted before the extension so nothing is overwritten inside the archive.
 */
function uniquePath(
  used: Set<string>,
  dir: string,
  filename: string,
  id: number,
): string {
  const safeName = safeSegment(filename) || `file-${id}`;
  let candidate = `${dir}/${safeName}`;
  if (used.has(candidate.toLowerCase())) {
    const dot = safeName.lastIndexOf(".");
    const base = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : "";
    candidate = `${dir}/${base} (${id})${ext}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}
