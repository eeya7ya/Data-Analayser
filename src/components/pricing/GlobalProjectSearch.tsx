"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Globe, X, Factory } from "lucide-react";
import { cn } from "@/lib/pricing/utils";

interface SearchHit {
  id: number;
  name: string;
  date: string | null;
  responsiblePerson?: string | null;
  ownerUserId: number | null;
  manufacturerId: number;
  manufacturerName: string;
  manufacturerColor?: string | null;
  manufacturerTag?: string | null;
  matchedInLines?: boolean;
  parentProjectId?: number | null;
  revisionNumber?: number | null;
}

interface Props {
  /** When set, search can be scoped to only this manufacturer via a toggle */
  currentManufacturerId?: number;
  /** When admin is viewing a manufacturer scoped to one owning user, pass
   *  that user id so "This manufacturer" search doesn't bleed across users. */
  currentOwnerUserId?: number | null;
  /** Callback when a result inside the current manufacturer is selected */
  onLocalSelect?: (projectId: number) => void;
  /** Placeholder shown in the search input */
  placeholder?: string;
}

/**
 * Free-text project search. Supports two scopes:
 *   - Global: every project across every manufacturer the user can see
 *   - This manufacturer: only projects inside the current manufacturer
 *
 * Results are fetched from /api/pricing/projects/search with a 250ms debounce.
 */
export function GlobalProjectSearch({
  currentManufacturerId,
  currentOwnerUserId,
  onLocalSelect,
  placeholder = "Search projects…",
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"global" | "local">("global");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q });
        if (scope === "local" && currentManufacturerId) {
          params.set("manufacturerId", String(currentManufacturerId));
          if (currentOwnerUserId != null) {
            params.set("ownerUserId", String(currentOwnerUserId));
          }
        }
        const res = await fetch(`/api/pricing/projects/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("search failed");
        const data: SearchHit[] = await res.json();
        setResults(data);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, scope, currentManufacturerId, currentOwnerUserId]);

  const handleSelect = (hit: SearchHit) => {
    setOpen(false);
    setQuery("");
    // If it's in the current manufacturer and caller provided a handler,
    // select it in-place without navigating.
    if (onLocalSelect && hit.manufacturerId === currentManufacturerId) {
      onLocalSelect(hit.id);
      return;
    }
    // Preserve owner scoping across navigation so the landing page shows
    // only the correct user's projects, not a blended admin view.
    const ownerQuery = hit.ownerUserId != null ? `&owner=${hit.ownerUserId}` : "";
    router.push(`/pricing/manufacturer/${hit.manufacturerId}?project=${hit.id}${ownerQuery}`);
  };

  const canScopeLocal = currentManufacturerId != null;

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-64 rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-8 text-sm text-gray-700 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
        />
        {loading ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
        ) : query ? (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && query.trim().length > 0 && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-[360px] max-w-[90vw] rounded-xl border border-gray-200 bg-white shadow-lg shadow-gray-200">
          {/* Scope toggle */}
          {canScopeLocal && (
            <div className="flex items-center gap-1 border-b border-gray-100 p-1">
              <button
                onClick={() => setScope("global")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                  scope === "global"
                    ? "bg-cyan-50 text-cyan-700"
                    : "text-gray-500 hover:bg-gray-50"
                )}
              >
                <Globe className="h-3 w-3" />
                All manufacturers
              </button>
              <button
                onClick={() => setScope("local")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
                  scope === "local"
                    ? "bg-cyan-50 text-cyan-700"
                    : "text-gray-500 hover:bg-gray-50"
                )}
              >
                <Factory className="h-3 w-3" />
                This manufacturer
              </button>
            </div>
          )}

          {/* Results */}
          <div className="max-h-80 overflow-y-auto p-1">
            {loading && results.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-400">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-400">
                No matching projects
              </p>
            ) : (
              results.map((hit) => (
                <button
                  key={`${hit.manufacturerId}-${hit.id}`}
                  onClick={() => handleSelect(hit)}
                  className="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
                >
                  <Factory className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-800">
                      {hit.name}
                      {(hit.parentProjectId != null ||
                        (hit.revisionNumber ?? 1) > 1) && (
                        <span className="ml-1.5 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                          v{hit.revisionNumber ?? 1}
                        </span>
                      )}
                      {hit.responsiblePerson && (
                        <span className="ml-1.5 text-xs font-normal text-gray-400">— {hit.responsiblePerson}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-gray-500">
                      <span className="truncate">{hit.manufacturerName}</span>
                      {hit.matchedInLines && (
                        <span className="flex-shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                          item match
                        </span>
                      )}
                      {hit.date && (
                        <span className="flex-shrink-0 text-gray-400">· {hit.date}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
