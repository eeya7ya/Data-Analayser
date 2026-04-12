"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QuotationPreview, {
  QuotationItem,
  QuotationExtraColumn,
} from "./QuotationPreview";
import { DEFAULT_TERMS } from "@/lib/quotationDraft";
import type { AppSettings } from "@/lib/settings";

interface SavedConfig {
  showPictures?: boolean;
  terms?: string[];
  salesPhone?: string;
  extraColumns?: QuotationExtraColumn[];
  scopeIntro?: string;
  designEng?: string;
  includeTax?: boolean;
  taxInclusive?: boolean;
}

/**
 * Robust fetch+parse for our API routes. The server wraps every handler in
 * try/catch and always returns JSON on the happy and error paths, but a
 * function timeout or runtime crash escapes that wrapper and Vercel/Next
 * replies with a plain text body that starts with "An error occurred…".
 *
 * When the list page then ran `fetch(…).then(r => r.json())` on that reply
 * it blew up with `Unexpected token 'A', "An error o"… is not valid JSON`
 * and the user just saw a cryptic parse error instead of a retry button.
 * This helper reads the body once, looks at the status + content-type,
 * and returns either the parsed JSON or a `{ __error }` sentinel with a
 * human-readable message the UI can surface cleanly.
 */
async function fetchJson<T>(
  url: string,
  opts: { signal?: AbortSignal } = {},
): Promise<T | { __error: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal: opts.signal, cache: "no-store" });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { __error: "Request timed out — check your connection and retry." };
    }
    return { __error: (err as Error).message || "Network error" };
  }
  const raw = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    // Try to unwrap JSON error bodies first so the user sees the API's
    // own `error` field. Fall through to the raw text otherwise, which is
    // the Vercel/Next generic HTML timeout page.
    if (ct.includes("application/json")) {
      try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (parsed?.error) return { __error: `${res.status}: ${parsed.error}` };
      } catch {
        /* fall through */
      }
    }
    const snippet = raw.trim().slice(0, 160) || res.statusText;
    return { __error: `${res.status} ${snippet}` };
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    const snippet = raw.trim().slice(0, 160);
    return { __error: `Server returned a non-JSON response: ${snippet}` };
  }
}

export default function QuotationViewer({
  quotationId,
  appSettings,
}: {
  /**
   * The quotation to load. Passed in from the server page so the shell
   * can paint immediately — the actual row is fetched from
   * `/api/quotations?id=<n>` on mount.
   */
  quotationId: number;
  appSettings: AppSettings;
}) {
  const fallbackTerms =
    appSettings.defaultTerms && appSettings.defaultTerms.length > 0
      ? appSettings.defaultTerms
      : DEFAULT_TERMS;
  const router = useRouter();

  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const ctl = new AbortController();
    // 25s matches the Vercel API function budget we set in vercel.json;
    // if the DB hasn't answered by then the API will have already failed
    // with a JSON error and we don't want to keep spinning.
    const timer = window.setTimeout(() => ctl.abort(), 25_000);
    fetchJson<{ quotation: Record<string, unknown> | null }>(
      `/api/quotations?id=${quotationId}`,
      { signal: ctl.signal },
    )
      .then((res) => {
        window.clearTimeout(timer);
        if ("__error" in res) {
          setLoadError(res.__error);
          return;
        }
        if (!res.quotation) {
          setLoadError("Quotation not found.");
          return;
        }
        setRow(res.quotation);
      })
      .finally(() => setLoading(false));
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [quotationId]);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load]);

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
        <p className="font-semibold">Failed to load this quotation.</p>
        <p className="mt-1 break-words">{loadError}</p>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => load()}
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

  if (!row) return null;

  // `items_json` comes straight from a jsonb column. Normally that decodes to
  // an array, but legacy/corrupt rows can surface an object or a JSON string,
  // either of which would make `.map` throw and crash the whole viewer.
  const rawItemsUnknown: unknown = row.items_json;
  const parsedItems: unknown =
    typeof rawItemsUnknown === "string"
      ? (() => {
          try {
            return JSON.parse(rawItemsUnknown);
          } catch {
            return [];
          }
        })()
      : rawItemsUnknown;
  const rawItems: QuotationItem[] = Array.isArray(parsedItems)
    ? (parsedItems as QuotationItem[])
    : [];
  const items: QuotationItem[] = rawItems.map((it) => ({
    ...it,
    system: it.system || it.brand || "General",
  }));
  // `config_json` is a jsonb column — normally decoded to a JS object, but
  // legacy/corrupted rows can surface a JSON string. Mirror DesignerShell's
  // normalisation so saved terms and settings are never silently lost.
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
  const config: SavedConfig =
    parsedConfig &&
    typeof parsedConfig === "object" &&
    !Array.isArray(parsedConfig)
      ? (parsedConfig as SavedConfig)
      : {};
  const id = Number(row.id);
  const header = {
    ref: String(row.ref),
    project_name: String(row.project_name),
    client_name: (row.client_name as string) || "",
    client_email: (row.client_email as string) || "",
    client_phone: (row.client_phone as string) || "",
    sales_engineer: (row.sales_engineer as string) || "",
    sales_phone: config.salesPhone || "",
    prepared_by: (row.prepared_by as string) || "",
    design_engineer: config.designEng || "",
    site_name: String(row.site_name),
    tax_percent: Number(row.tax_percent || 0),
    date: new Date(String(row.created_at)).toLocaleDateString("en-GB"),
    extra_columns: Array.isArray(config.extraColumns)
      ? config.extraColumns
      : [],
    scope_intro: config.scopeIntro || "",
  };

  return (
    <div>
      <div className="no-print flex justify-end mb-3 gap-2">
        <button
          onClick={() => router.push(`/designer?id=${id}`)}
          className="rounded-md border border-magic-border px-4 py-2 text-sm font-semibold hover:bg-magic-soft"
        >
          Edit
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          Print / PDF
        </button>
      </div>
      <QuotationPreview
        header={header}
        items={items}
        editable={false}
        showPictures={Boolean(config.showPictures)}
        terms={
          // Whatever the author persisted wins — even if it happens to
          // equal the hardcoded default list verbatim. The previous
          // "yield to admin-edited presets when terms match built-ins"
          // heuristic was clever but silently erased user edits when the
          // admin later tweaked defaults, which the user reported as
          // "my terms never save".
          Array.isArray(config.terms) && config.terms.length > 0
            ? config.terms
            : [...fallbackTerms]
        }
        includeTax={config.includeTax !== false}
        taxInclusive={Boolean(config.taxInclusive)}
        footerText={appSettings.footerText}
      />
    </div>
  );
}
