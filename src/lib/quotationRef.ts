import type { Sql } from "postgres";
import { d1Query } from "./db-d1";

/**
 * The leading "<DEPT>-FO<YY>-" segment of an auto-generated quotation reference.
 *
 * The department code's trailing two characters are replaced by the first two
 * letters of the author's username, so a reference identifies the PERSON as well
 * as the department: department "ITD1" + user "Yahya" → "ITYA". The 4-hex counter
 * (appended by the caller) is scoped per this prefix and per calendar year, so it
 * keeps its full 65,535/year capacity and stays unique across users.
 *
 * Falls back to the raw department code (or "GEN") when there's no username, and
 * to "GEN" when there's no department.
 */
export function quotationRefPrefix(
  departmentCode: string,
  username: string,
): string {
  const dept = (departmentCode || "GEN").trim().toUpperCase() || "GEN";
  const initials = (username || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 2)
    .toUpperCase();
  // Swap the department's last two chars for the user initials (e.g. the "D1"
  // in "ITD1" → "YA"); on a very short department code, append instead.
  const base = initials
    ? (dept.length > 2 ? dept.slice(0, dept.length - 2) : dept) + initials
    : dept;
  const yy = String(new Date().getFullYear()).slice(-2);
  return `${base}-FO${yy}-`;
}

/** 4-digit (min) uppercase hex, e.g. 1 → "0001", 4096 → "1000". */
export function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * The next active quotation reference for an author: `<prefix><HEX4>`, e.g.
 * "ITYA-FO26-0001". The counter is the lowest unused positive integer among
 * live (non-deleted) refs sharing the prefix, so deleted numbers are reused.
 * Read-only and idempotent — calling it twice returns the same value until a
 * quotation is actually saved, which is exactly what makes it safe to call from
 * the Designer's live preview as well as the create handler.
 */
export async function genActiveRef(
  useD1: boolean,
  q: Sql | null,
  departmentCode: string,
  username: string,
): Promise<string> {
  const prefix = quotationRefPrefix(departmentCode, username);

  // Every live (non-deleted) ref. Soft-deleted rows are excluded so their
  // counters become reusable.
  let rows: Array<{ ref: string }>;
  if (useD1) {
    const result = await d1Query<{ ref: string }>(
      `select ref from quotations where deleted_at is null`,
    );
    rows = result.results;
  } else {
    rows = (await q!`
      select ref from quotations
      where deleted_at is null
    `) as Array<{ ref: string }>;
  }

  // Collect used counters for THIS prefix. The counter is exactly the 4 hex
  // chars right after the prefix; draft/review refs append a `.D<m>` / `.R<m>`
  // suffix and share their root's counter, so reading the leading 4 hex chars
  // is correct.
  const used = new Set<number>();
  for (const { ref } of rows) {
    if (!ref || !ref.startsWith(prefix)) continue;
    const tail = ref.slice(prefix.length, prefix.length + 4);
    if (/^[0-9A-Fa-f]{4}$/.test(tail)) used.add(parseInt(tail, 16));
  }

  // Lowest unused positive integer.
  let n = 1;
  while (used.has(n)) n++;

  // Collision probe. The unique index on `ref` is authoritative; this pre-check
  // just avoids a failed INSERT round-trip if two requests race on the same
  // counter, and skips counters held by a soft-deleted row.
  for (let attempts = 0; attempts < 200; attempts++) {
    const candidate = `${prefix}${hex4(n)}`;
    let existing: Array<Record<string, unknown>>;
    if (useD1) {
      const result = await d1Query<Record<string, unknown>>(
        `select 1 from quotations where ref = ? limit 1`,
        [candidate],
      );
      existing = result.results;
    } else {
      existing = (await q!`
        select 1 from quotations where ref = ${candidate} limit 1
      `) as unknown as Array<Record<string, unknown>>;
    }
    if (existing.length === 0) return candidate;
    n++;
  }
  return `${prefix}${hex4(n)}`;
}
