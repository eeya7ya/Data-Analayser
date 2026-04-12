"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import type { AppSettings } from "@/lib/settings";
import Designer, { type ExistingQuotation } from "./Designer";

/**
 * Client-side loader for an existing quotation on /designer?id=<N>.
 *
 * The /designer server component used to run `ensureSchema()` + a
 * `select * from quotations ...` inside the render path, which meant a
 * cold Supabase pooler handshake blocked the entire RSC stream.  Under
 * slow-DB conditions the Vercel function would sit on the query for
 * ~20 s and the user would just see the Next.js `loading.tsx` skeleton
 * frozen in place ("when I press Edit the screen gets stuck"), with no
 * timeout and no retry affordance.
 *
 * Mirroring the /quotation viewer, we now hand the id off to this
 * client component so the server render finishes instantly; the
 * fetch happens on the browser and has a hard abort budget + a visible
 * "Retry" button when it fails.  The ownership check on the API route
 * still enforces per-user access.
 */
export default function DesignerShell({
  user,
  quotationId,
  appSettings,
}: {
  user: SessionUser;
  quotationId: number;
  appSettings: AppSettings;
}) {
  const router = useRouter();
  const [existing, setExisting] = useState<ExistingQuotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const ctl = new AbortController();
    // 25 s matches the /quotation viewer — long enough to cover a cold
    // Supabase start, short enough to surface a retry button before the
    // user concludes the app is broken.
    const timer = window.setTimeout(() => ctl.abort(), 25_000);
    (async () => {
      let res: Response;
      try {
        res = await fetch(`/api/quotations?id=${quotationId}`, {
          signal: ctl.signal,
          cache: "no-store",
        });
      } catch (err) {
        if (cancelled) return;
        if ((err as Error).name === "AbortError") {
          setLoadError("Request timed out — please retry.");
        } else {
          setLoadError((err as Error).message || "Network error");
        }
        setLoading(false);
        return;
      }
      window.clearTimeout(timer);
      const raw = await res.text();
      const ct = res.headers.get("content-type") || "";
      if (!res.ok) {
        if (cancelled) return;
        if (ct.includes("application/json")) {
          try {
            const parsed = JSON.parse(raw) as { error?: string };
            if (parsed?.error) {
              setLoadError(`${res.status}: ${parsed.error}`);
              setLoading(false);
              return;
            }
          } catch {
            /* fall through */
          }
        }
        setLoadError(`${res.status} ${raw.trim().slice(0, 160) || res.statusText}`);
        setLoading(false);
        return;
      }
      let data: { quotation: Record<string, unknown> | null };
      try {
        data = JSON.parse(raw) as {
          quotation: Record<string, unknown> | null;
        };
      } catch {
        if (cancelled) return;
        setLoadError("Server returned a non-JSON response.");
        setLoading(false);
        return;
      }
      if (cancelled) return;
      const row = data.quotation;
      if (!row) {
        setLoadError("Quotation not found, or you don't have access to it.");
        setLoading(false);
        return;
      }

      // `items_json` / `config_json` usually decode to a JS value, but
      // legacy/corrupted rows have been observed to come back as a JSON
      // string.  Normalize both so the Designer never has to defend
      // against the wrong shape.
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
      const itemsArray = Array.isArray(parsedItems)
        ? (parsedItems as ExistingQuotation["items_json"])
        : [];

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
      const configObject =
        parsedConfig &&
        typeof parsedConfig === "object" &&
        !Array.isArray(parsedConfig)
          ? (parsedConfig as ExistingQuotation["config_json"])
          : {};

      setExisting({
        id: Number(row.id),
        ref: String(row.ref),
        project_name: String(row.project_name),
        client_name: (row.client_name as string) || null,
        client_email: (row.client_email as string) || null,
        client_phone: (row.client_phone as string) || null,
        sales_engineer: (row.sales_engineer as string) || null,
        prepared_by: (row.prepared_by as string) || null,
        site_name: String(row.site_name),
        tax_percent: Number(row.tax_percent ?? 16),
        folder_id: row.folder_id ? Number(row.folder_id) : null,
        items_json: itemsArray,
        config_json: configObject,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [quotationId, reloadTick]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-10 text-center text-sm text-magic-ink/60">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-magic-red/30 border-t-magic-red" />
        Loading quotation #{quotationId}…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p className="font-semibold">Failed to open this quotation.</p>
        <p className="mt-1 break-words">{loadError}</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setReloadTick((t) => t + 1)}
            className="rounded-md bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
          <button
            onClick={() => router.push("/quotation")}
            className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold hover:bg-magic-soft"
          >
            Back to list
          </button>
        </div>
      </div>
    );
  }

  if (!existing) return null;

  return (
    <Designer
      user={user}
      existing={existing}
      appSettings={appSettings}
    />
  );
}
