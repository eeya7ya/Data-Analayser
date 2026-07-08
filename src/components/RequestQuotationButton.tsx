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
  /** Latest quotation built for this RFQ, once presales has produced one. */
  quote_id: number | null;
  quote_ref: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  new: "Waiting for presales to claim",
  in_progress: "In progress with presales",
};

export default function RequestQuotationButton({
  projectId,
  projectName,
  canRequestHint,
  initialRfq,
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
  /**
   * The project's active RFQ, resolved on the SERVER and seeded here so the
   * correct button ("View quotation" / "Request for Modification" / status
   * chip) paints on first render. Without it the button defaulted to
   * "Request for Quotation" and then visibly swapped once a client
   * `/api/leads` fetch resolved — the "buttons re-render" complaint.
   * `undefined` means "not seeded" (we'll fetch + show a skeleton meanwhile);
   * `null` means "seeded, and there is no open RFQ".
   */
  initialRfq?: OpenRfq | null;
}) {
  const [canRequest, setCanRequest] = useState<boolean | null>(
    canRequestHint === undefined ? null : canRequestHint,
  );
  const [rfq, setRfq] = useState<OpenRfq | null>(initialRfq ?? null);
  // Seeded → already resolved; otherwise we wait for the fetch before we
  // commit to a button so we never flash the wrong one.
  const [rfqLoaded, setRfqLoaded] = useState<boolean>(initialRfq !== undefined);
  const [open, setOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);

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
      const leads = data.leads ?? [];
      // Prefer a lead that already has a quotation (so we can show "view +
      // request modification"); otherwise the open RFQ status chip.
      const active =
        leads.find((l) => l.quote_id) ??
        leads.find((l) => l.status === "new" || l.status === "in_progress") ??
        null;
      setRfq(active);
    } catch {
      setRfq(null);
    } finally {
      setRfqLoaded(true);
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

  // Status not resolved yet AND not seeded by the server — show a neutral
  // skeleton rather than defaulting to "Request for Quotation", which would
  // then visibly swap to "View quotation" once the lead lands.
  if (!rfqLoaded) {
    return (
      <div
        className="h-8 w-44 animate-pulse rounded-lg border border-magic-border bg-magic-soft/40"
        aria-hidden
      />
    );
  }

  // Presales has produced a quotation — sales can view it (read-only) and,
  // instead of a fresh RFQ, request a modification that goes straight to the
  // presales who designed it. No longer "Request for Quotation".
  if (rfq && rfq.quote_id) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/quotation?id=${rfq.quote_id}&view=1`}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
          >
            View quotation{rfq.quote_ref ? ` · ${rfq.quote_ref}` : ""}
          </a>
          <button
            onClick={() => setModifyOpen(true)}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            Request for Modification
          </button>
        </div>
        {modifyOpen && (
          <ModificationModal
            leadId={rfq.id}
            presales={rfq.assigned_to_username}
            onClose={() => setModifyOpen(false)}
            onDone={() => {
              setModifyOpen(false);
              void refresh();
            }}
          />
        )}
      </>
    );
  }

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
  // Files on this project the salesperson can choose to share with the
  // presales who picks up the RFQ (selective sales↔presales sharing).
  const [files, setFiles] = useState<Array<{ id: number; filename: string }>>([]);
  const [shareIds, setShareIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/project-files?project_id=${projectId}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          files?: Array<{ id: number; filename: string; shared_with_counterpart?: boolean }>;
        };
        if (cancelled) return;
        setFiles((data.files ?? []).map((f) => ({ id: f.id, filename: f.filename })));
        // Pre-tick any files already shared, so the selection reflects reality.
        setShareIds(
          new Set(
            (data.files ?? [])
              .filter((f) => f.shared_with_counterpart)
              .map((f) => f.id),
          ),
        );
      } catch {
        /* no files / no access — the checklist just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function toggleShare(id: number) {
    setShareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      // Share the ticked files with the presales counterpart. Best-effort per
      // file — a share hiccup shouldn't fail the RFQ that was just created.
      await Promise.all(
        files.map((f) =>
          fetch(`/api/project-files/${f.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ shared_with_counterpart: shareIds.has(f.id) }),
          }).catch(() => {}),
        ),
      );
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

          <div>
            <label className="block text-xs font-semibold text-magic-ink/70 mb-1">
              Share files with presales
            </label>
            {files.length === 0 ? (
              <p className="rounded border border-dashed border-magic-border px-2 py-2 text-xs text-magic-ink/45">
                No files on this project yet. Upload files under the project&apos;s
                Files/BOQ tab, then choose them here.
              </p>
            ) : (
              <>
                <p className="mb-1 text-[11px] text-magic-ink/50">
                  Only the files you tick are visible to the presales who builds
                  the quote — nothing else is shared.
                </p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-magic-border p-2">
                  {files.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 text-xs text-magic-ink/80"
                    >
                      <input
                        type="checkbox"
                        checked={shareIds.has(f.id)}
                        onChange={() => toggleShare(f.id)}
                      />
                      <span className="truncate">{f.filename}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
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

/**
 * "Request for Modification" — the salesperson reviewed the quotation and
 * wants changes. Routed directly to the presales who designed it (the lead's
 * assignee) via /api/leads/:id/request-modification, not the shared queue.
 */
function ModificationModal({
  leadId,
  presales,
  onClose,
  onDone,
}: {
  leadId: number;
  presales: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/request-modification`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() || null }),
      });
      if (!res.ok) {
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
          <h3 className="font-semibold text-magic-ink">Request for Modification</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="mb-3 text-xs text-magic-ink/60">
          Goes straight to{" "}
          {presales ? `@${presales}` : "the presales who designed it"} — not the
          shared queue.
        </p>
        <textarea
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What needs changing? (pricing, scope, items…)"
          className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
        />
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
            disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
