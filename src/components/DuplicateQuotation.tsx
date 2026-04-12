"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Folder {
  id: number;
  name: string;
}

/**
 * "Duplicate" button for the quotations list.
 *
 * The flow is an intentional "copy then paste into a client folder" —
 * the user opens a dropdown of every client folder they can write to,
 * picks one, and the component:
 *
 *   1. Fetches the source quotation (items, config, totals, header).
 *   2. Strips the ref so the server mints a fresh `QY…` number (the
 *      existing `POST /api/quotations` route already does this when
 *      `ref` is omitted).
 *   3. Wipes `client_name` / `client_email` / `client_phone` so the
 *      server falls back to the target folder's CRM fields and the
 *      copy "rebases" onto the destination client automatically.
 *      (The POST handler does this — see `(body.client_name && …) ||
 *      folderClientName`.)
 *   4. Sends a POST with the new `folder_id`.
 *   5. Routes to /designer?id=<new> so the user can edit the copy.
 *
 * Pasting into the source's own folder is explicitly supported — the
 * user just gets an exact duplicate under the same client, with a new
 * ref. Pasting into a different folder means "move this design to
 * another customer", which is the useful part.
 */
export default function DuplicateQuotation({
  quotationId,
  currentFolderId,
  folders,
}: {
  quotationId: number;
  currentFolderId: number | null;
  folders: Folder[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function duplicateTo(targetFolderId: number | null) {
    setLoading(true);
    setError(null);
    try {
      // Step 1 — pull the source row. We use the same API the viewer
      // uses so ownership checks still apply; a user can't duplicate a
      // quotation they can't already read.
      const srcRes = await fetch(`/api/quotations?id=${quotationId}`);
      if (!srcRes.ok) {
        throw new Error(`Failed to load source quotation (${srcRes.status})`);
      }
      const srcData = (await srcRes.json()) as {
        quotation: Record<string, unknown> | null;
      };
      const row = srcData.quotation;
      if (!row) throw new Error("Source quotation not found.");

      // Normalize jsonb fields the way the Designer does. Legacy/corrupt
      // rows can surface these as JSON strings.
      const rawItems: unknown = row.items_json;
      const parsedItems: unknown =
        typeof rawItems === "string"
          ? (() => {
              try {
                return JSON.parse(rawItems);
              } catch {
                return [];
              }
            })()
          : rawItems;
      const items = Array.isArray(parsedItems) ? parsedItems : [];

      const rawConfig: unknown = row.config_json;
      const parsedConfig: unknown =
        typeof rawConfig === "string"
          ? (() => {
              try {
                return JSON.parse(rawConfig);
              } catch {
                return {};
              }
            })()
          : rawConfig;
      const config =
        parsedConfig &&
        typeof parsedConfig === "object" &&
        !Array.isArray(parsedConfig)
          ? (parsedConfig as Record<string, unknown>)
          : {};

      const rawTotals: unknown = row.totals_json;
      const parsedTotals: unknown =
        typeof rawTotals === "string"
          ? (() => {
              try {
                return JSON.parse(rawTotals);
              } catch {
                return {};
              }
            })()
          : rawTotals;
      const totals =
        parsedTotals &&
        typeof parsedTotals === "object" &&
        !Array.isArray(parsedTotals)
          ? (parsedTotals as Record<string, unknown>)
          : {};

      // Step 2 — build a POST payload. Deliberately omit `ref` (server
      // mints a new QY-number), and deliberately leave `client_*`
      // empty so the POST handler rebases onto the destination folder's
      // CRM data. `sales_engineer` and `prepared_by` are left as-is so
      // the duplicated quotation still carries the author info.
      const payload = {
        project_name: row.project_name
          ? `${String(row.project_name)} (copy)`
          : "Untitled Quotation (copy)",
        sales_engineer: (row.sales_engineer as string) || undefined,
        prepared_by: (row.prepared_by as string) || undefined,
        site_name: (row.site_name as string) || "SITE",
        tax_percent: Number(row.tax_percent ?? 16),
        folder_id: targetFolderId,
        items,
        totals,
        config,
      };

      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        quotation?: { id: number; ref: string };
        error?: string;
      };
      if (!res.ok || !data.quotation) {
        throw new Error(data.error || "Failed to duplicate quotation.");
      }

      setOpen(false);
      // Land on the new copy in the Designer so the user can tweak it
      // immediately. The list will be out of date until the next load,
      // but that's fine because we're navigating away.
      router.push(`/designer?id=${data.quotation.id}`);
    } catch (err) {
      setError((err as Error).message || "Failed to duplicate quotation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="text-xs text-magic-red hover:underline disabled:opacity-50"
        title="Duplicate this quotation into a client folder"
      >
        {loading ? "Copying…" : "Copy"}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-64 rounded-md border border-magic-border bg-white shadow-lg py-1 text-sm max-h-72 overflow-y-auto">
          <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-magic-ink/50">
            Paste a copy into…
          </div>
          {folders.length === 0 && (
            <div className="px-3 py-2 text-xs text-magic-ink/50 italic">
              No client folders yet — create one first.
            </div>
          )}
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => duplicateTo(f.id)}
              disabled={loading}
              className={`w-full text-left px-3 py-1.5 hover:bg-magic-header disabled:opacity-50 ${
                currentFolderId === f.id
                  ? "font-semibold text-magic-red"
                  : ""
              }`}
            >
              {f.name}
              {currentFolderId === f.id && (
                <span className="ml-1 text-[10px] italic text-magic-ink/50">
                  (same client)
                </span>
              )}
            </button>
          ))}
          {error && (
            <div className="mt-1 border-t border-magic-border px-3 py-2 text-[11px] text-red-600">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
