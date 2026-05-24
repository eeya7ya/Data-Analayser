import { useEffect, useState } from "react";

export interface NameConflict {
  id: number;
  name: string;
  kind: "company" | "individual";
}

/**
 * Debounced live de-dup check for the New Company / New Individual forms.
 * Returns the cross-kind rows that block creation (empty = name is free).
 * The server enforces the same rule on POST, so this is purely the
 * inline warning that lets the user fix the name before submitting.
 */
export function useNameConflicts(
  name: string,
  kind: "company" | "individual",
): NameConflict[] {
  const [matches, setMatches] = useState<NameConflict[]>([]);

  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ name: trimmed, kind });
      void fetch(`/api/crm/name-check?${params}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { matches?: NameConflict[] }) => {
          if (!cancelled) setMatches(Array.isArray(data.matches) ? data.matches : []);
        })
        .catch(() => {
          if (!cancelled) setMatches([]);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, kind]);

  return matches;
}
