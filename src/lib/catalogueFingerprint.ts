/**
 * Shared change-detection fingerprint for catalogue rows.
 *
 * Used by BOTH the browser (CatalogueUpload) and the server
 * (/api/catalogue/fingerprints) so a re-imported spreadsheet can skip rows that
 * haven't actually changed instead of re-uploading the entire catalogue.
 *
 * Only the plain data fields are fingerprinted — NOT the picture. Pictures are
 * re-compressed every time a workbook is re-imported (see `compressDataUrl` +
 * `extractWorksheetImages`), so their bytes drift on every round-trip and can't
 * be compared for equality. Picture changes are handled separately by the
 * caller (newly-added pictures, or an explicit "refresh images" opt-in).
 *
 * The hash must be computed identically on both sides, so this module is pure
 * and dependency-free.
 */

/** Fields that round-trip losslessly through export → Excel edit → import. */
export interface FingerprintFields {
  vendor: string;
  system: string;
  category: string;
  sub_category: string;
  fast_view: string;
  description: string;
  currency: string;
  price_si: number | string;
  specifications: string;
}

/** Field separator: a control char that never appears in catalogue text, so
 * field boundaries can't blur (e.g. "AB"+"C" must not collide with "A"+"BC"). */
const SEP = String.fromCharCode(1);

/** Normalise a price to a stable canonical string (115, 115.0, "195.00" → "195"). */
function normPrice(p: number | string): string {
  const n = typeof p === "number" ? p : parseFloat(String(p));
  return Number.isFinite(n) ? String(n) : "0";
}

/**
 * cyrb53 — a fast, deterministic, dependency-free string hash. Returns a base-36
 * string. Not cryptographic; collision odds are negligible for catalogue-sized
 * field concatenations and it only needs to detect "did this row change".
 */
export function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Fingerprint the data fields of a catalogue row. Values are trimmed so the
 * client (already-trimmed parse) and server (trimmed on store) agree, and the
 * price is normalised so numeric-format drift doesn't read as a change.
 */
export function fingerprintRow(r: FingerprintFields): string {
  return hashString(
    [
      String(r.vendor ?? "").trim(),
      String(r.system ?? "").trim(),
      String(r.category ?? "").trim(),
      String(r.sub_category ?? "").trim(),
      String(r.fast_view ?? "").trim(),
      String(r.description ?? "").trim(),
      String(r.currency ?? "").trim(),
      normPrice(r.price_si),
      String(r.specifications ?? "").trim(),
    ].join(SEP),
  );
}
