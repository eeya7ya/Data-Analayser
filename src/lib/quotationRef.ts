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
 * Lowest unused positive counter for `prefix`, given every LIVE (non-deleted)
 * ref. This is the single source of truth for "the next available number", so
 * the Designer's ref preview shows exactly what the server will mint on save
 * (see genActiveRef, which now defers to this too).
 *
 * The counter is the 4 hex chars right after the prefix; draft/review refs
 * append a `.D<m>` / `.R<m>` suffix and share their root's counter, so reading
 * the leading 4 hex chars is correct. Callers pass only non-deleted refs, so a
 * trashed quotation's number is freed for reuse.
 */
export function nextRefCounter(liveRefs: string[], prefix: string): number {
  const used = new Set<number>();
  for (const ref of liveRefs) {
    if (!ref || !ref.startsWith(prefix)) continue;
    const tail = ref.slice(prefix.length, prefix.length + 4);
    if (/^[0-9A-Fa-f]{4}$/.test(tail)) used.add(parseInt(tail, 16));
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}
