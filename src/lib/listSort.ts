/**
 * Shared client-side sort helpers for the CRM list surfaces (Companies and
 * Individual clients). Both lists offer the same four orderings — alphabetical
 * by name (A→Z / Z→A) and chronological by creation date (newest / oldest) —
 * so the comparator and the dropdown option list live here once and are reused
 * by CompanyListClient and ClientListClient.
 */

export type ListSortKey = "name-asc" | "name-desc" | "newest" | "oldest";

export const LIST_SORT_OPTIONS: ReadonlyArray<{
  value: ListSortKey;
  label: string;
}> = [
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

/** Parse an ISO timestamp to epoch ms; missing / invalid dates sort as 0. */
function dateValue(s: string | null | undefined): number {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Returns a NEW array sorted by the requested key. Name sorts are
 * case-insensitive and numeric-aware ("Client 2" < "Client 10"); date sorts
 * use `created_at` (the row's creation timestamp).
 */
export function sortList<T extends { name: string; created_at?: string | null }>(
  items: T[],
  key: ListSortKey,
): T[] {
  const copy = [...items];
  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  switch (key) {
    case "name-desc":
      return copy.sort((a, b) => byName(b, a));
    case "newest":
      return copy.sort((a, b) => dateValue(b.created_at) - dateValue(a.created_at));
    case "oldest":
      return copy.sort((a, b) => dateValue(a.created_at) - dateValue(b.created_at));
    case "name-asc":
    default:
      return copy.sort(byName);
  }
}
