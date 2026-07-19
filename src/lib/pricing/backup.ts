import { sql, rawBinder } from "@/lib/db";
import { calculateRow, type Constants } from "@/lib/pricing/calculations";

/**
 * Pricing backup / restore — one place that serialises EVERY pricing parameter
 * (manufacturer + its per-vendor defaults, each project's header, revision
 * lineage, constants and product lines) to JSON or CSV, and restores it back on
 * either backend.
 *
 * D1 has no interactive transactions and cannot use the postgres.js sql(rows)
 * bulk-insert helper, so restore runs plain statements (built with rawBinder
 * for the multi-row line insert) with per-project error isolation.
 */

export const BACKUP_FORMAT_VERSION = 2;

export interface BackupLine {
  position: number;
  itemModel: string;
  priceUsd: string;
  quantity: number;
  shippingOverride: string | null;
  customsOverride: string | null;
  shippingRateOverride: string | null;
  customsRateOverride: string | null;
  profitRateOverride: string | null;
  description: string | null;
}

export interface BackupConstants {
  currencyRate: string;
  shippingRate: string;
  customsRate: string;
  profitMargin: string;
  taxRate: string;
  targetCurrency: string;
  sourceCurrency: string;
}

export interface BackupProject {
  name: string;
  date: string | null;
  responsiblePerson: string | null;
  createdAt: string;
  revisionNumber: number;
  /** Index (in this manufacturer's project list) of the revision parent, or null. */
  parentIndex: number | null;
  constants: BackupConstants | null;
  productLines: BackupLine[];
}

export interface BackupManufacturer {
  name: string;
  defaultShippingRate: string | null;
  defaultCustomsRate: string | null;
  defaultProfitMargin: string | null;
  projects: BackupProject[];
}

export interface BackupPayload {
  formatVersion: number;
  exportedAt: string;
  manufacturers: BackupManufacturer[];
}

type Q = ReturnType<typeof sql>;

const DEFAULT_CONSTANTS: BackupConstants = {
  currencyRate: "0.710000",
  shippingRate: "0.150000",
  customsRate: "0.120000",
  profitMargin: "0.250000",
  taxRate: "0.160000",
  targetCurrency: "JOD",
  sourceCurrency: "USD",
};

// ── Build a backup for one manufacturer ──────────────────────────────────────
export async function buildManufacturerBackup(
  q: Q,
  mfgId: number,
  mfgName: string,
  ownerFilter: number | "all",
): Promise<BackupManufacturer> {
  const defRows = (await q`
    select default_shipping_rate as ship, default_customs_rate as cust,
           default_profit_margin as profit
    from pricing_manufacturers where id = ${mfgId} limit 1
  `) as Array<{ ship: unknown; cust: unknown; profit: unknown }>;
  const def = defRows[0];

  const projectRows = (
    ownerFilter === "all"
      ? ((await q`
          select id, name, date, responsible_person, created_at,
                 revision_number, parent_project_id
          from pricing_projects
          where manufacturer_id = ${mfgId} and deleted_at is null
          order by coalesce(parent_project_id, id) asc, revision_number asc, created_at asc
        `) as Array<Record<string, unknown>>)
      : ((await q`
          select id, name, date, responsible_person, created_at,
                 revision_number, parent_project_id
          from pricing_projects
          where manufacturer_id = ${mfgId} and deleted_at is null
            and user_id = ${ownerFilter}
          order by coalesce(parent_project_id, id) asc, revision_number asc, created_at asc
        `) as Array<Record<string, unknown>>)
  );

  const manufacturer: BackupManufacturer = {
    name: mfgName,
    defaultShippingRate: def?.ship != null ? String(def.ship) : null,
    defaultCustomsRate: def?.cust != null ? String(def.cust) : null,
    defaultProfitMargin: def?.profit != null ? String(def.profit) : null,
    projects: [],
  };
  if (projectRows.length === 0) return manufacturer;

  const projectIds = projectRows.map((p) => p.id as number);
  const idToIndex = new Map<number, number>();
  projectRows.forEach((p, i) => idToIndex.set(p.id as number, i));

  // Read children in batches that stay under D1/SQLite's ~100 bound-parameter
  // cap. `= any(<ids>)` expands to one placeholder per id on D1, so a
  // manufacturer with enough sheets would overflow the cap and 500 the whole
  // backup export. Each project id lands in exactly one batch, so per-project
  // grouping/ordering below is unaffected.
  const ID_CHUNK = 90;
  const constants: Array<Record<string, unknown>> = [];
  for (let i = 0; i < projectIds.length; i += ID_CHUNK) {
    const batch = projectIds.slice(i, i + ID_CHUNK);
    const rows = (await q`
      select project_id, currency_rate, shipping_rate, customs_rate,
             profit_margin, tax_rate, target_currency, source_currency
      from pricing_project_constants
      where project_id = any(${batch}::int[])
    `) as Array<Record<string, unknown>>;
    constants.push(...rows);
  }
  const constMap = new Map<number, BackupConstants>();
  for (const c of constants) {
    constMap.set(c.project_id as number, {
      currencyRate: String(c.currency_rate),
      shippingRate: String(c.shipping_rate),
      customsRate: String(c.customs_rate),
      profitMargin: String(c.profit_margin),
      taxRate: String(c.tax_rate),
      targetCurrency: String(c.target_currency),
      sourceCurrency: String(c.source_currency),
    });
  }

  const lines: Array<Record<string, unknown>> = [];
  for (let i = 0; i < projectIds.length; i += ID_CHUNK) {
    const batch = projectIds.slice(i, i + ID_CHUNK);
    const rows = (await q`
      select project_id, position, item_model, price_usd, quantity,
             shipping_override, customs_override,
             shipping_rate_override, customs_rate_override, profit_rate_override,
             description
      from pricing_product_lines
      where project_id = any(${batch}::int[])
      order by project_id asc, position asc
    `) as Array<Record<string, unknown>>;
    lines.push(...rows);
  }
  const lineMap = new Map<number, BackupLine[]>();
  for (const l of lines) {
    const pid = l.project_id as number;
    const bucket = lineMap.get(pid) ?? [];
    bucket.push({
      position: l.position as number,
      itemModel: (l.item_model as string) ?? "",
      priceUsd: String(l.price_usd),
      quantity: l.quantity as number,
      shippingOverride: l.shipping_override != null ? String(l.shipping_override) : null,
      customsOverride: l.customs_override != null ? String(l.customs_override) : null,
      shippingRateOverride: l.shipping_rate_override != null ? String(l.shipping_rate_override) : null,
      customsRateOverride: l.customs_rate_override != null ? String(l.customs_rate_override) : null,
      profitRateOverride: l.profit_rate_override != null ? String(l.profit_rate_override) : null,
      description: l.description != null ? String(l.description) : null,
    });
    lineMap.set(pid, bucket);
  }

  manufacturer.projects = projectRows.map((p) => {
    const pid = p.id as number;
    const parentId = p.parent_project_id as number | null;
    return {
      name: p.name as string,
      date: (p.date as string | null) ?? null,
      responsiblePerson: (p.responsible_person as string | null) ?? null,
      createdAt:
        p.created_at instanceof Date
          ? (p.created_at as Date).toISOString()
          : String(p.created_at ?? ""),
      revisionNumber: p.revision_number != null ? Number(p.revision_number) : 1,
      parentIndex:
        parentId != null && idToIndex.has(parentId)
          ? (idToIndex.get(parentId) as number)
          : null,
      constants: constMap.get(pid) ?? null,
      productLines: lineMap.get(pid) ?? [],
    };
  });
  return manufacturer;
}

// ── Restore one manufacturer's projects into a target manufacturer id ─────────
export interface RestoreResult {
  restored: number;
  skipped: number;
  failures: { name: string; error: string }[];
}

export async function restoreProjects(
  q: Q,
  mfgId: number,
  ownerId: number,
  projects: BackupProject[],
  suffix: string,
): Promise<RestoreResult> {
  const failures: { name: string; error: string }[] = [];
  let restored = 0;
  let skipped = 0;
  // Map a source project index → new DB id, so revision parents can be relinked
  // in a second pass once every project exists.
  const newIds: Array<number | null> = [];

  for (let idx = 0; idx < projects.length; idx++) {
    const bp = projects[idx];
    newIds.push(null);
    if (!bp || typeof bp !== "object" || typeof bp.name !== "string" || !bp.name.trim()) {
      skipped++;
      continue;
    }
    const name = `${bp.name.trim()}${suffix}`;
    try {
      // Project row.
      const projectRows = (await q`
        insert into pricing_projects (
          name, date, responsible_person, manufacturer_id, user_id, revision_number
        ) values (
          ${name}, ${bp.date ?? null},
          ${typeof bp.responsiblePerson === "string" ? bp.responsiblePerson : null},
          ${mfgId}, ${ownerId},
          ${typeof bp.revisionNumber === "number" && bp.revisionNumber > 0 ? bp.revisionNumber : 1}
        )
        returning id
      `) as Array<{ id: number }>;
      const newId = projectRows[0].id;
      newIds[idx] = newId;

      // Constants.
      const c = bp.constants ?? DEFAULT_CONSTANTS;
      await q`
        insert into pricing_project_constants (
          project_id, currency_rate, shipping_rate, customs_rate,
          profit_margin, tax_rate, target_currency, source_currency
        ) values (
          ${newId},
          ${c.currencyRate ?? DEFAULT_CONSTANTS.currencyRate},
          ${c.shippingRate ?? DEFAULT_CONSTANTS.shippingRate},
          ${c.customsRate ?? DEFAULT_CONSTANTS.customsRate},
          ${c.profitMargin ?? DEFAULT_CONSTANTS.profitMargin},
          ${c.taxRate ?? DEFAULT_CONSTANTS.taxRate},
          ${c.targetCurrency ?? "JOD"},
          ${c.sourceCurrency ?? "USD"}
        )
      `;

      // Product lines. These MUST be inserted in chunks that stay under
      // D1/SQLite's ~100 bound-parameter cap. A single all-rows INSERT binds 11
      // params per line, so a sheet with 10+ lines overflowed the cap, D1
      // rejected the whole statement, and — because the project row was already
      // committed (D1 has no interactive transaction) — the restored sheet came
      // back with the header and constants but ZERO product lines. That is the
      // "restored items have no cells" bug. Mirror the Save path
      // (src/app/api/pricing/projects/[id]/route.ts): chunk under the cap, and
      // if the V1.8 `description` column is missing on this DB, retry without it.
      const rawLines = Array.isArray(bp.productLines) ? bp.productLines : [];
      if (rawLines.length > 0) {
        // Resolve each line's final position once (dedup collisions) so the
        // numbering is stable no matter how the rows are split across chunks.
        const seen = new Set<number>();
        const resolved = rawLines.map((l, i) => {
          let position = typeof l.position === "number" ? l.position : i + 1;
          while (seen.has(position)) position++;
          seen.add(position);
          return { l, position };
        });
        const insertLines = async (withDesc: boolean) => {
          const perChunk = withDesc ? 8 : 9; // ≤ ~100 bound params per statement
          for (let start = 0; start < resolved.length; start += perChunk) {
            const batch = resolved.slice(start, start + perChunk);
            const { P, params } = rawBinder();
            const tuples = batch
              .map(({ l, position }) => {
                const cells = [
                  P(newId),
                  P(position),
                  P(typeof l.itemModel === "string" ? l.itemModel : ""),
                  P(l.priceUsd != null ? String(l.priceUsd) : "0"),
                  P(typeof l.quantity === "number" && l.quantity > 0 ? l.quantity : 1),
                  P(l.shippingOverride != null ? String(l.shippingOverride) : null),
                  P(l.customsOverride != null ? String(l.customsOverride) : null),
                  P(l.shippingRateOverride != null ? String(l.shippingRateOverride) : null),
                  P(l.customsRateOverride != null ? String(l.customsRateOverride) : null),
                  P(l.profitRateOverride != null ? String(l.profitRateOverride) : null),
                ];
                if (withDesc) {
                  cells.push(
                    P(
                      typeof l.description === "string" && l.description.trim()
                        ? l.description
                        : null,
                    ),
                  );
                }
                return `(${cells.join(", ")})`;
              })
              .join(", ");
            const cols = withDesc
              ? `(project_id, position, item_model, price_usd, quantity,
                  shipping_override, customs_override,
                  shipping_rate_override, customs_rate_override, profit_rate_override,
                  description)`
              : `(project_id, position, item_model, price_usd, quantity,
                  shipping_override, customs_override,
                  shipping_rate_override, customs_rate_override, profit_rate_override)`;
            await q.unsafe(
              `insert into pricing_product_lines ${cols} values ${tuples}`,
              params,
            );
          }
        };
        try {
          await insertLines(true);
        } catch {
          // The `description` column is likely absent on this DB. Clear any
          // rows the first pass managed to insert (fresh project, so this is
          // safe) and re-insert without it so a restore never drops its lines.
          await q`delete from pricing_product_lines where project_id = ${newId}`;
          await insertLines(false);
        }
      }
      restored++;
    } catch (projErr) {
      failures.push({ name: bp.name.trim(), error: (projErr as Error).message || "insert failed" });
    }
  }

  // Second pass: relink revision parents now that all new ids exist.
  for (let idx = 0; idx < projects.length; idx++) {
    const bp = projects[idx];
    const myId = newIds[idx];
    if (myId == null || bp?.parentIndex == null) continue;
    const parentNewId = newIds[bp.parentIndex];
    if (parentNewId != null && parentNewId !== myId) {
      try {
        await q`update pricing_projects set parent_project_id = ${parentNewId} where id = ${myId}`;
      } catch {
        // lineage relink is best-effort; the project itself is already restored
      }
    }
  }

  return { restored, skipped, failures };
}

// ── CSV serialise / parse (flat: one row per product line) ────────────────────
const CSV_COLUMNS = [
  "mfg_idx", "manufacturer", "default_shipping_rate", "default_customs_rate", "default_profit_margin",
  "project_idx", "project", "date", "responsible", "revision_number", "parent_project_idx",
  "currency_rate", "shipping_rate", "customs_rate", "profit_margin", "tax_rate",
  "target_currency", "source_currency",
  "line_position", "item_model", "price_usd", "quantity",
  "shipping_override", "customs_override", "shipping_rate_override",
  "customs_rate_override", "profit_rate_override", "description",
  // Computed snapshot columns (read-only — ignored on restore, which recomputes
  // from the inputs above). Present so a CSV backup opened in Excel shows the
  // real per-line values, not just the raw USD inputs.
  "jod_unit", "jod_total", "shipping_unit", "shipping_total",
  "customs_unit", "customs_total", "landed_unit", "landed_total",
  "profit_unit", "profit_total", "pretax_unit", "pretax_total",
  "tax_unit", "tax_total", "final_unit", "final_total",
] as const;

/** BackupConstants (string cells) → numeric Constants for calculateRow. */
function toNumericConstants(c: BackupConstants): Constants {
  const n = (v: string, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  };
  return {
    currencyRate: n(c.currencyRate, 0.71),
    shippingRate: n(c.shippingRate, 0.15),
    customsRate: n(c.customsRate, 0.12),
    profitMargin: n(c.profitMargin, 0.25),
    taxRate: n(c.taxRate, 0.16),
  };
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function payloadToCsv(payload: BackupPayload): string {
  const rows: string[] = [CSV_COLUMNS.join(",")];
  payload.manufacturers.forEach((m, mi) => {
    m.projects.forEach((p, pi) => {
      const c = p.constants ?? DEFAULT_CONSTANTS;
      const base = [
        mi, m.name, m.defaultShippingRate ?? "", m.defaultCustomsRate ?? "", m.defaultProfitMargin ?? "",
        pi, p.name, p.date ?? "", p.responsiblePerson ?? "", p.revisionNumber, p.parentIndex ?? "",
        c.currencyRate, c.shippingRate, c.customsRate, c.profitMargin, c.taxRate,
        c.targetCurrency, c.sourceCurrency,
      ];
      const nc = toNumericConstants(c);
      // Count of computed columns appended after the input columns.
      const COMPUTED_BLANKS = new Array(16).fill("");
      if (p.productLines.length === 0) {
        rows.push(
          [...base, "", "", "", "", "", "", "", "", "", "", ...COMPUTED_BLANKS]
            .map(csvCell)
            .join(","),
        );
      } else {
        for (const l of p.productLines) {
          const calc = calculateRow(
            {
              itemModel: l.itemModel,
              priceUsd: Number(l.priceUsd) || 0,
              quantity: l.quantity,
              shippingOverride: l.shippingOverride != null ? Number(l.shippingOverride) : null,
              customsOverride: l.customsOverride != null ? Number(l.customsOverride) : null,
              shippingRateOverride:
                l.shippingRateOverride != null ? Number(l.shippingRateOverride) : null,
              customsRateOverride:
                l.customsRateOverride != null ? Number(l.customsRateOverride) : null,
              profitRateOverride:
                l.profitRateOverride != null ? Number(l.profitRateOverride) : null,
            },
            nc,
          );
          const f = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "");
          rows.push(
            [
              ...base, l.position, l.itemModel, l.priceUsd, l.quantity,
              l.shippingOverride ?? "", l.customsOverride ?? "",
              l.shippingRateOverride ?? "", l.customsRateOverride ?? "", l.profitRateOverride ?? "",
              l.description ?? "",
              f(calc.jodPrice), f(calc.jodPriceTotal),
              f(calc.shipping), f(calc.shippingTotal),
              f(calc.customs), f(calc.customsTotal),
              f(calc.landedCost), f(calc.landedCostTotal),
              f(calc.profit), f(calc.profitTotal),
              f(calc.preTaxPrice), f(calc.preTaxPriceTotal),
              f(calc.tax), f(calc.taxTotal),
              f(calc.finalPrice), f(calc.finalPriceTotal),
            ].map(csvCell).join(","),
          );
        }
      }
    });
  });
  return rows.join("\r\n");
}

/** Minimal RFC-4180 CSV row parser. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (ch === "\r") { /* handled by \n */ }
    else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function csvToPayload(text: string): BackupPayload {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) {
    return { formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), manufacturers: [] };
  }
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const col = (r: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? r[i] : "";
  };

  const mfgs = new Map<string, BackupManufacturer>();
  const projByKey = new Map<string, BackupProject>();
  const orderedProjKeys = new Map<string, string[]>(); // mfgKey → project keys in order

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const mfgKey = col(row, "mfg_idx") || col(row, "manufacturer");
    if (!mfgs.has(mfgKey)) {
      mfgs.set(mfgKey, {
        name: col(row, "manufacturer") || "Restored",
        defaultShippingRate: col(row, "default_shipping_rate") || null,
        defaultCustomsRate: col(row, "default_customs_rate") || null,
        defaultProfitMargin: col(row, "default_profit_margin") || null,
        projects: [],
      });
      orderedProjKeys.set(mfgKey, []);
    }
    const projKey = `${mfgKey}::${col(row, "project_idx") || col(row, "project")}`;
    if (!projByKey.has(projKey)) {
      const parentRaw = col(row, "parent_project_idx");
      const proj: BackupProject = {
        name: col(row, "project") || "Restored project",
        date: col(row, "date") || null,
        responsiblePerson: col(row, "responsible") || null,
        createdAt: new Date().toISOString(),
        revisionNumber: Number(col(row, "revision_number")) || 1,
        parentIndex: parentRaw.trim() !== "" ? Number(parentRaw) : null,
        constants: {
          currencyRate: col(row, "currency_rate") || DEFAULT_CONSTANTS.currencyRate,
          shippingRate: col(row, "shipping_rate") || DEFAULT_CONSTANTS.shippingRate,
          customsRate: col(row, "customs_rate") || DEFAULT_CONSTANTS.customsRate,
          profitMargin: col(row, "profit_margin") || DEFAULT_CONSTANTS.profitMargin,
          taxRate: col(row, "tax_rate") || DEFAULT_CONSTANTS.taxRate,
          targetCurrency: col(row, "target_currency") || "JOD",
          sourceCurrency: col(row, "source_currency") || "USD",
        },
        productLines: [],
      };
      projByKey.set(projKey, proj);
      orderedProjKeys.get(mfgKey)!.push(projKey);
      mfgs.get(mfgKey)!.projects.push(proj);
    }
    const proj = projByKey.get(projKey)!;
    const pos = col(row, "line_position");
    const model = col(row, "item_model");
    if (pos.trim() !== "" || model.trim() !== "" || col(row, "price_usd").trim() !== "") {
      proj.productLines.push({
        position: Number(pos) || proj.productLines.length + 1,
        itemModel: model,
        priceUsd: col(row, "price_usd") || "0",
        quantity: Number(col(row, "quantity")) || 1,
        shippingOverride: col(row, "shipping_override") || null,
        customsOverride: col(row, "customs_override") || null,
        shippingRateOverride: col(row, "shipping_rate_override") || null,
        customsRateOverride: col(row, "customs_rate_override") || null,
        profitRateOverride: col(row, "profit_rate_override") || null,
        description: col(row, "description") || null,
      });
    }
  }

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    manufacturers: [...mfgs.values()],
  };
}

/** Normalise any accepted restore body (bare array, legacy {projects}, v2
 *  {manufacturers}) into a manufacturers[] list. */
export function normaliseRestoreBody(body: unknown): BackupManufacturer[] | null {
  if (Array.isArray(body)) {
    return [{ name: "", defaultShippingRate: null, defaultCustomsRate: null, defaultProfitMargin: null, projects: body as BackupProject[] }];
  }
  if (body && typeof body === "object") {
    const b = body as Partial<BackupPayload> & { projects?: BackupProject[] };
    if (Array.isArray(b.manufacturers)) return b.manufacturers;
    if (Array.isArray(b.projects)) {
      return [{ name: "", defaultShippingRate: null, defaultCustomsRate: null, defaultProfitMargin: null, projects: b.projects }];
    }
  }
  return null;
}
