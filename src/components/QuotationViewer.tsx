"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QuotationPreview, {
  QuotationItem,
  QuotationExtraColumn,
} from "./QuotationPreview";
import { DEFAULT_TERMS } from "@/lib/quotationDraft";
import type { AppSettings } from "@/lib/settings";
import { runQuotationPrint } from "@/lib/printQuotation";
import QuotationApprovalBar from "./QuotationApprovalBar";
import QuotationStockCheckPanel from "./QuotationStockCheckPanel";

interface SavedConfig {
  showPictures?: boolean;
  terms?: string[];
  salesPhone?: string;
  extraColumns?: QuotationExtraColumn[];
  scopeIntro?: string;
  designEng?: string;
  includeTax?: boolean;
  taxInclusive?: boolean;
  brandVariantId?: string;
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
  // BoQ toggle — flipped on just before opening the print dialog so the
  // preview re-renders without the Unit Price / Total Price columns and
  // the Final Totals page. Cleared on `afterprint` so the on-screen
  // viewer goes back to the priced layout immediately. The `pendingBoqRef`
  // (header context captured at click time) is consumed by the effect
  // below once React commits the BoQ-flipped DOM.
  const [boqMode, setBoqMode] = useState(false);
  const pendingBoqRef = useRef<{ ref: string; projectName: string } | null>(
    null,
  );
  // V1.3b — a plain salesperson can't edit; the Edit button is swapped for
  // "Request changes" which routes a note back to the presales author.
  const [salesLocked, setSalesLocked] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestDone, setRequestDone] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (data: {
          user: { role: string } | null;
          module_roles: Array<{ module: string; role: string }>;
        }) => {
          if (cancelled) return;
          const isAdmin = data.user?.role === "admin";
          const crm = (data.module_roles || [])
            .filter((r) => r.module === "crm")
            .map((r) => r.role);
          const locked =
            !isAdmin &&
            crm.includes("sales") &&
            !crm.includes("presales") &&
            !crm.includes("presales_manager") &&
            !crm.includes("sales_manager");
          setSalesLocked(locked);
        },
      )
      .catch(() => {
        if (!cancelled) setSalesLocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitChangeRequest() {
    const note = requestNote.trim();
    if (!note) return;
    setRequestBusy(true);
    setRequestError(null);
    try {
      const res = await fetch("/api/quotations/request-changes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: quotationId, note }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      setRequestDone(true);
      setRequesting(false);
      setRequestNote("");
    } catch (err) {
      setRequestError((err as Error).message);
    } finally {
      setRequestBusy(false);
    }
  }

  // Once BoQ mode is committed to the DOM, hand off to the shared print
  // helper — same code path the Designer's Print buttons and this viewer's
  // Print / Print Draft buttons use, so the running page header (logo)
  // and footer (address bar) repeat consistently no matter which button
  // was pressed.
  //
  // Placed up here — above the loading / error / empty early returns — so
  // the hook count is stable across every render (Rules of Hooks).
  useEffect(() => {
    if (!boqMode) return;
    const pending = pendingBoqRef.current;
    if (!pending) return;
    runQuotationPrint({
      ref: pending.ref,
      projectName: pending.projectName,
      kind: "boq",
      afterPrint: () => {
        setBoqMode(false);
        pendingBoqRef.current = null;
      },
    });
  }, [boqMode]);

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

  // All three print buttons (Print / PDF, Print Draft, Print BOQ) funnel
  // through `runQuotationPrint` so the printed page header (logo strip)
  // and footer (address bar) repeat identically regardless of the button
  // pressed or the page size selected in the browser print dialog.
  function runPrint(draft: boolean) {
    runQuotationPrint({
      ref: header.ref,
      projectName: header.project_name,
      kind: draft ? "draft" : "normal",
    });
  }

  function runPrintBoq() {
    pendingBoqRef.current = {
      ref: header.ref,
      projectName: header.project_name,
    };
    setBoqMode(true);
  }

  const approvalState = {
    sales_approved_by: (row.sales_approved_by as number | null) ?? null,
    sales_approved_at: (row.sales_approved_at as string | null) ?? null,
    presales_approved_by: (row.presales_approved_by as number | null) ?? null,
    presales_approved_at: (row.presales_approved_at as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    accepted_at: (row.accepted_at as string | null) ?? null,
    rejected_at: (row.rejected_at as string | null) ?? null,
    rejected_by: (row.rejected_by as number | null) ?? null,
    rejected_reason: (row.rejected_reason as string | null) ?? null,
  };

  return (
    <div>
      <QuotationApprovalBar quotationId={id} initial={approvalState} />
      <div className="no-print flex flex-wrap justify-end mb-3 gap-2">
        {salesLocked ? (
          <button
            onClick={() => {
              setRequestDone(false);
              setRequestError(null);
              setRequesting(true);
            }}
            title="You can't edit a quotation from presales — send the changes you need back to the presales author"
            className="rounded-md border border-magic-border px-4 py-2 text-sm font-semibold hover:bg-magic-soft"
          >
            Request changes
          </button>
        ) : (
          <button
            onClick={() => router.push(`/designer?id=${id}`)}
            className="rounded-md border border-magic-border px-4 py-2 text-sm font-semibold hover:bg-magic-soft"
          >
            Edit
          </button>
        )}
        <button
          onClick={() =>
            router.push(`/purchase-orders?quotation=${id}`)
          }
          title="Create a purchase order linked to this quotation"
          className="rounded-md border border-magic-border px-4 py-2 text-sm font-semibold hover:bg-magic-soft"
        >
          Convert to PO
        </button>
        <button
          onClick={() => runPrint(false)}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          Print / PDF
        </button>
        <button
          onClick={() => runPrint(true)}
          title="Print without the cover and about-us pages (internal draft)"
          className="rounded-md border border-magic-red text-magic-red px-4 py-2 text-sm font-semibold hover:bg-magic-red hover:text-white transition-colors"
        >
          Print Draft
        </button>
        <button
          onClick={runPrintBoq}
          title="Print the Bill of Quantities — items only, no pricing columns or totals"
          className="rounded-md border border-magic-red text-magic-red px-4 py-2 text-sm font-semibold hover:bg-magic-red hover:text-white transition-colors"
        >
          Print BOQ
        </button>
      </div>
      {requestDone && (
        <div className="no-print mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Change request sent to the presales author — they&apos;ll get a
          notification and can update the quotation.
        </div>
      )}
      {requesting && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-magic-border bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-magic-ink">
              Request changes
            </h3>
            <p className="mt-1 text-xs text-magic-ink/60">
              Describe the update or modification you need. This goes back to
              the presales author who can edit the quotation and resend it.
            </p>
            <textarea
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              rows={4}
              autoFocus
              placeholder="e.g. Client wants 4K cameras instead of 1080p on the 2nd floor, and remove the spare switch."
              className="mt-3 w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
            />
            {requestError && (
              <p className="mt-2 text-xs text-red-700">{requestError}</p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setRequesting(false)}
                disabled={requestBusy}
                className="rounded-md border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitChangeRequest()}
                disabled={requestBusy || !requestNote.trim()}
                className="rounded-md bg-magic-red px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {requestBusy ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* The QuotationPreview is hard-coded to A4 width (210mm) so the
          printed page matches the production template exactly. On
          narrower screens that overflows the parent card and pushes
          everything sideways; the no-print wrapper here keeps the
          fixed-width sheet inside a horizontally scrollable box so
          the surrounding chrome stays put. Print CSS bypasses .no-print
          ancestors entirely, so paper output is unaffected. */}
      <div className="no-print overflow-x-auto">
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
          brandVariantId={config.brandVariantId}
          boqMode={boqMode}
        />
      </div>
      <QuotationStockCheckPanel quotationId={id} />
    </div>
  );
}
