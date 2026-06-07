"use client";

import { useCallback, useEffect, useState } from "react";
import { LEAD_PRIORITIES } from "@/lib/leadConstants";

/**
 * Per-project "Request for Quotation" affordance shown in the project
 * drill-down header. This is a SALES action — a salesperson asks presales to
 * build a quote against a project, and tracks it right here:
 *
 *   • No open RFQ  → "Request for Quotation" button → inline dialog → POST.
 *   • Open RFQ     → a live status chip (waiting / in progress + who).
 *
 * Visibility is intentionally SALES-ONLY (crm role `sales` / `sales_manager`).
 * Presales BUILD quotations — they fulfil RFQs from the /leads queue, they
 * don't request them — so they (and a plain admin acting in a quotation-
 * building capacity) never see this. The server still re-validates and
 * enforces the one-open-per-project rule (409), so a stale tab can't
 * double-open.
 */

interface OpenRfq {
  id: number;
  ref: string;
  status: string;
  assigned_to_username: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  new: "Waiting for presales to claim",
  in_progress: "In progress with presales",
};

export default function RequestQuotationButton({
  projectId,
  projectName,
  canRequestHint,
}: {
  projectId: number;
  projectName: string;
  /**
   * Set by callers that already resolved /api/auth/me (e.g. via
   * useCrmCaps in FolderProjectsClient). When `true`, we skip the
   * button's own auth/me round-trip and render the affordance right
   * away. Without it the button used to chain three sequential fetches
   * (parent /api/auth/me → child /api/auth/me → /api/leads) which made
   * the button take ~5 s to appear on a cold pooler.
   */
  canRequestHint?: boolean;
}) {
  const [canRequest, setCanRequest] = useState<boolean | null>(
    canRequestHint === undefined ? null : canRequestHint,
  );
  const [rfq, setRfq] = useState<OpenRfq | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads?project_id=${projectId}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setRfq(null);
        return;
      }
      const data = (await res.json()) as { leads?: OpenRfq[] };
      const openOne =
        (data.leads ?? []).find(
          (l) => l.status === "new" || l.status === "in_progress",
        ) ?? null;
      setRfq(openOne);
    } catch {
      setRfq(null);
    }
  }, [projectId]);

  // Only run the auth/me probe when the caller couldn't tell us — sales
  // callers (FolderProjectsClient) already did this work upstream, and
  // re-doing it here is exactly the latency the user complained about.
  useEffect(() => {
    if (canRequest !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const me = (await fetch("/api/auth/me", { cache: "no-store" }).then(
          (r) => r.json(),
        )) as {
          user?: { role?: string } | null;
          module_roles?: Array<{ module: string; role: string }>;
        };
        if (cancelled) return;
        const crmRoles = (me.module_roles ?? [])
          .filter((r) => r.module === "crm")
          .map((r) => r.role);
        const cap =
          crmRoles.includes("sales") || crmRoles.includes("sales_manager");
        setCanRequest(cap);
      } catch {
        if (!cancelled) setCanRequest(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Look up the open RFQ once we know we can request. The button shell
  // renders before this resolves — the status chip just swaps in when
  // an open RFQ is found, instead of gating the whole button on a fetch.
  useEffect(() => {
    if (canRequest !== true) return;
    void refresh();
  }, [canRequest, refresh]);

  if (canRequest !== true) return null;

  if (rfq) {
    const tone =
      rfq.status === "new"
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-blue-300 bg-blue-50 text-blue-800";
    const detail =
      rfq.status === "in_progress" && rfq.assigned_to_username
        ? `In progress — @${rfq.assigned_to_username}`
        : STATUS_TEXT[rfq.status] ?? rfq.status;
    return (
      <div className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${tone}`}>
        <div>Quotation requested · {rfq.ref}</div>
        <div className="mt-0.5 font-normal">{detail}</div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
      >
        Request for Quotation
      </button>
      {open && (
        <RequestQuotationModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function RequestQuotationModal({
  projectId,
  projectName,
  onClose,
  onDone,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(`RFQ — ${projectName}`);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          project_id: projectId,
        }),
      });
      if (!res.ok) {
        // 409 = a request is already open for this project; just surface it.
        if (res.status === 409) {
          onDone();
          return;
        }
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-magic-ink">Request for Quotation</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="mb-3 text-xs text-magic-ink/60">
          Presales pick this up from the shared queue and build the quotation
          against this project. You&apos;ll track its status right here.
        </p>

        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
              Description / scope
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does the client need? Constraints, budget hints, technical scope…"
              className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
            >
              {LEAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-magic-soft disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !title.trim()}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
