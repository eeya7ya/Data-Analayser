"use client";

import { useCallback, useEffect, useState } from "react";
import ConvertToProjectDialog from "@/components/ConvertToProjectDialog";

/**
 * Action bar surfaced inside QuotationViewer. Presales hands the quotation
 * to sales ("Send to sales"); sales records the client outcome (Accepted /
 * Lost / Held) and pushes a won deal to the projects team. There is no
 * sales-manager approval step — sales asks presales for changes via the RFQ
 * "Request for Modification" flow rather than approving their work.
 *
 * Server-side enforcement lives in /api/quotations/outcome, /reject and
 * /project-handoffs — this UI only hides buttons the user can't action.
 *
 * Re-fetches the quotation snapshot after each action so the pill
 * reflects the new state without a full page refresh.
 */

interface ApprovalState {
  sales_approved_by: number | null;
  sales_approved_at: string | null;
  presales_approved_by: number | null;
  presales_approved_at: string | null;
  approved_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  rejected_by: number | null;
  rejected_reason: string | null;
  // V1.3D — sales client-outcome.
  sales_outcome: string | null;
  sales_outcome_at: string | null;
  sales_outcome_reason: string | null;
  hold_transfer_at: string | null;
  transferred_at: string | null;
  // 1.4C — RFQ handoff between presales and sales.
  sent_to_sales_at: string | null;
  sent_to_sales_by: number | null;
  sales_accepted_at: string | null;
  sales_accepted_by: number | null;
  owner_id: number | null;
  // Executive-manager sign-off.
  exec_status?: "none" | "pending" | "confirmed" | "rejected" | null;
  exec_reject_reason?: string | null;
}

interface MeResponse {
  user: { id: number; role: string } | null;
  module_roles: Array<{ module: string; role: string }>;
}

export default function QuotationApprovalBar({
  quotationId,
  initial,
  projectId,
  readOnly = false,
}: {
  quotationId: number;
  initial: ApprovalState;
  /** The quotation's project, so an Accepted deal can attach the client's
   * signed PO straight into the Purchase Orders tab. */
  projectId?: number | null;
  /**
   * Read-only mode (default for this view now): the sales-outcome controls
   * (Reject, Accepted / Rejected / Hold, Proceed to Execution) are redundant —
   * sales drive those from the Quote-to-Delivery pipeline — so they are hidden
   * and the bar shows STATUS only. The presales "Send to sales" handoff and the
   * post-win PO upload (which have no pipeline equivalent) remain.
   */
  readOnly?: boolean;
}) {
  const [state, setState] = useState<ApprovalState>(initial);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(false);
  // V1.3D — sales outcome (Accept / Reject / Hold for Execution).
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdAt, setHoldAt] = useState("");

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: MeResponse) => setMe(data))
      .catch(() => setMe({ user: null, module_roles: [] }));
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotations?id=${quotationId}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { quotation?: ApprovalState };
      if (data.quotation) setState(data.quotation);
    } catch {
      // soft-fail: the pill keeps its old state, which is still accurate
    }
  }, [quotationId]);

  // Refresh the full state once on mount so the bar reflects decisions made
  // elsewhere since the page loaded — e.g. an executive confirmation/rejection.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  const isAdmin = me?.user?.role === "admin";
  const hasRole = (module: string, role: string) =>
    isAdmin ||
    !!me?.module_roles.some((r) => r.module === module && r.role === role);

  // Sales can reject a quotation (send it back) but no longer "approves"
  // presales' work — they ask for modifications via the RFQ flow instead.
  const canReject =
    isAdmin || hasRole("crm", "sales") || hasRole("crm", "sales_manager");
  const canConvert =
    isAdmin || hasRole("crm", "sales") || hasRole("crm", "sales_manager");

  // 1.4C — presales → sales handoff. The author (or an admin) presses
  // "Send to sales" once the quotation is ready, and the sales person who
  // raised the RFQ either accepts or files a change request.
  const isOwner =
    !!me?.user?.id && state.owner_id !== null && me.user.id === state.owner_id;
  const isPresalesAuthor =
    isAdmin || isOwner || hasRole("crm", "presales") || hasRole("crm", "presales_manager");
  // Any presales author / manager / admin can send to sales (server mirrors
  // this via canAuthorQuotation). Previously this also required ownership,
  // which hid the button for presales colleagues on the same project.
  const canSendToSales = isPresalesAuthor;
  const sentToSales = !!state.sent_to_sales_at;
  const salesAccepted = !!state.sales_accepted_at;

  // Executive-manager confirmation: a quotation is submitted to the executive
  // by SALES / sales managers only — they own the deal (presales just prepare
  // it), and admin is deliberately not part of this workflow gate.
  const canSubmitExec = !!me?.module_roles.some(
    (r) => r.module === "crm" && (r.role === "sales" || r.role === "sales_manager"),
  );
  const execStatus = state.exec_status ?? "none";

  async function submitExec() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/executive/confirmations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "quotation",
          id: quotationId,
          action: "submit",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendToSales() {
    if (
      sentToSales &&
      !window.confirm(
        "Re-send the quotation to sales? The previous acceptance (if any) will be cleared so they re-review the latest version.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/send-to-sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: quotationId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const reason = window.prompt(
      "Reject this quotation. Provide a brief reason — the author will see this on the quotation:",
    );
    if (!reason || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: quotationId, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function markOutcome(
    outcome: "accepted" | "rejected" | "held",
    extra: { reason?: string; hold_transfer_at?: string | null } = {},
  ) {
    setOutcomeBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: quotationId, outcome, ...extra }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setHoldOpen(false);
      setHoldAt("");
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOutcomeBusy(false);
    }
  }

  async function rejectOutcome() {
    const reason = window.prompt(
      "Mark this lead LOST. A reason is required — say why (client passed, lost to a competitor, budget, …):",
    );
    if (reason === null) return; // dialog cancelled — leave the outcome unset
    if (!reason.trim()) {
      setError("A reason is required to mark the lead as lost.");
      return;
    }
    await markOutcome("rejected", { reason: reason.trim() });
  }

  async function transferNow() {
    setOutcomeBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/transfer-hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: quotationId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOutcomeBusy(false);
    }
  }

  const accepted = !!state.accepted_at || state.sales_outcome === "accepted";
  const rejected = !!state.rejected_at;
  const outcome = state.sales_outcome;
  const transferred = !!state.transferred_at;
  const heldPending = outcome === "held" && !transferred;

  // In read-only mode the only thing this bar carries that the Quote-to-Delivery
  // pipeline has no equivalent for is the presales "Send to sales" handoff. The
  // status strip ("Sent to sales / Sales reviewed / Client accepted") is pure
  // duplication of the pipeline, and the post-win client-PO upload has its own
  // home in the project's Purchase Orders tab — so for anyone who can't hand the
  // quotation to sales (every salesperson / viewer), the bar renders nothing at
  // all instead of a redundant strip on top of every quotation.
  if (readOnly && !canSendToSales) {
    return null;
  }

  return (
    <div className="no-print rounded-xl border border-magic-border bg-white px-4 py-3 mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-magic-ink/70">Approval:</span>
          {sentToSales ? (
            <Pill tone={salesAccepted ? "ok" : "muted"}>
              Sent to sales{salesAccepted ? "" : " · awaiting review"}
            </Pill>
          ) : (
            isPresalesAuthor && <Pill tone="muted">Not yet sent to sales</Pill>
          )}
          {salesAccepted && <Pill tone="ok">Sales reviewed</Pill>}
          {accepted && <Pill tone="strong">Client accepted</Pill>}
          {rejected && (
            <Pill tone="warn">
              Rejected
              {state.rejected_reason && `: ${state.rejected_reason.slice(0, 60)}`}
            </Pill>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canSendToSales && (
            <button
              onClick={() => void sendToSales()}
              disabled={busy}
              title={
                sentToSales
                  ? "Re-send the latest version to the salesperson who raised the RFQ"
                  : "Hand the quotation back to the salesperson who raised the RFQ"
              }
              className="px-3 py-1 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
            >
              {sentToSales ? "Re-send to sales" : "Send to sales"}
            </button>
          )}
          {canReject && !rejected && !readOnly && (
            <button
              onClick={() => void reject()}
              disabled={busy}
              className="px-3 py-1 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          )}
        </div>
      </div>

      {/* Executive confirmation — presales submits the finished quotation for
          the executive manager to confirm. */}
      {(canSubmitExec || execStatus !== "none") && (
        <div className="mt-3 border-t border-magic-border/60 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-magic-ink/70">Executive:</span>
              {execStatus === "pending" && (
                <Pill tone="muted">Awaiting confirmation</Pill>
              )}
              {execStatus === "confirmed" && <Pill tone="ok">Confirmed ✓</Pill>}
              {execStatus === "rejected" && (
                <Pill tone="warn">
                  Rejected
                  {state.exec_reject_reason &&
                    `: ${state.exec_reject_reason.slice(0, 60)}`}
                </Pill>
              )}
              {execStatus === "none" && (
                <span className="text-magic-ink/45">Not submitted</span>
              )}
            </div>
            {canSubmitExec && execStatus !== "pending" && (
              <button
                onClick={() => void submitExec()}
                disabled={busy}
                title="Send this quotation to the executive manager for confirmation"
                className="px-3 py-1 text-xs font-semibold rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {execStatus === "none"
                  ? "Submit for executive confirmation"
                  : "Re-submit for confirmation"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* V1.3D — sales records the client outcome. Accept / Reject can be
          marked any time; Hold for Execution stages the deal and (with a
          time set) auto-transfers it to the projects team. In read-only mode
          (e.g. the presales view) only the status pills render — sales drive
          the outcome from the Quote-to-Delivery pipeline now. */}
      {(canConvert || outcome || transferred) && (
        <div className="mt-3 border-t border-magic-border/60 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-magic-ink/70">Outcome:</span>
              {outcome === "accepted" && <Pill tone="ok">Won — client accepted</Pill>}
              {outcome === "rejected" && (
                <Pill tone="warn">
                  Lost
                  {state.sales_outcome_reason &&
                    `: ${state.sales_outcome_reason.slice(0, 60)}`}
                </Pill>
              )}
              {heldPending && (
                <Pill tone="strong">
                  Held for execution
                  {state.hold_transfer_at
                    ? ` · auto-transfers ${new Date(state.hold_transfer_at).toLocaleString()}`
                    : " · manual transfer"}
                </Pill>
              )}
              {transferred && <Pill tone="ok">Sent to projects ✓</Pill>}
              {!outcome && !transferred && (
                <span className="text-magic-ink/45">Not set yet</span>
              )}
            </div>
            {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              {!transferred && (
                <>
                  <button
                    onClick={() => void markOutcome("accepted")}
                    disabled={outcomeBusy}
                    title="Client accepted the quotation"
                    className="px-3 py-1 text-xs font-semibold rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                  >
                    Accepted
                  </button>
                  <button
                    onClick={() => void rejectOutcome()}
                    disabled={outcomeBusy}
                    title="The client passed — record why and mark the lead lost"
                    className="px-3 py-1 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50 transition-colors"
                  >
                    Rejected · Lead Lost
                  </button>
                  <button
                    onClick={() => setHoldOpen((v) => !v)}
                    disabled={outcomeBusy}
                    title="Park the won deal — stage it (optionally on a schedule) before it goes to the projects team"
                    className="px-3 py-1 text-xs font-semibold rounded border border-magic-red text-magic-red hover:bg-magic-red hover:text-white disabled:opacity-50 transition-colors"
                  >
                    Hold for execution
                  </button>
                  <button
                    onClick={() => setConverting(true)}
                    disabled={outcomeBusy || rejected || (!accepted && !heldPending)}
                    title={
                      accepted || heldPending
                        ? "Forward the deal to the project manager now — capture site / contact details and hand it off"
                        : "Mark the quotation Accepted or Held first"
                    }
                    className="px-3 py-1 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
                  >
                    {converted ? "Proceed to Execution ✓" : "Proceed to Execution"}
                  </button>
                </>
              )}
              {heldPending && (
                <button
                  onClick={() => void transferNow()}
                  disabled={outcomeBusy}
                  className="px-3 py-1 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
                >
                  Transfer now
                </button>
              )}
            </div>
            )}
          </div>
          {accepted && projectId ? (
            <PoUploadInline projectId={projectId} />
          ) : null}
          {!readOnly && holdOpen && !transferred && (
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-magic-border bg-magic-soft/40 p-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-magic-ink/60">
                  Auto-transfer at (optional)
                </label>
                <input
                  type="datetime-local"
                  value={holdAt}
                  onChange={(e) => setHoldAt(e.target.value)}
                  className="mt-1 rounded-md border border-magic-border px-2 py-1 text-sm"
                />
              </div>
              <button
                onClick={() =>
                  void markOutcome("held", { hold_transfer_at: holdAt || null })
                }
                disabled={outcomeBusy}
                className="rounded-md bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
              >
                {holdAt ? "Hold & schedule" : "Hold (manual transfer)"}
              </button>
              <button
                onClick={() => setHoldOpen(false)}
                disabled={outcomeBusy}
                className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold hover:bg-magic-soft disabled:opacity-50"
              >
                Cancel
              </button>
              <p className="w-full text-[11px] text-magic-ink/50">
                Leave the time empty to transfer manually whenever you&apos;re
                ready. With a time set, the deal moves to the projects team
                automatically once it passes.
              </p>
            </div>
          )}
        </div>
      )}
      {converted && (
        <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
          Sent to projects — a project manager will assign a technician/engineer.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}
      {converting && (
        <ConvertToProjectDialog
          quotationId={quotationId}
          onClose={() => setConverting(false)}
          onConverted={() => {
            setConverting(false);
            setConverted(true);
          }}
        />
      )}
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "muted" | "warn" | "strong";
  children: React.ReactNode;
}) {
  const tones: Record<typeof tone, string> = {
    ok: "border-emerald-300 bg-emerald-50 text-emerald-800",
    muted: "border-magic-border bg-magic-soft/40 text-magic-ink/60",
    warn: "border-amber-300 bg-amber-50 text-amber-800",
    strong: "border-magic-red bg-magic-red/10 text-magic-red",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Accepted → upload the client's signed PO. A won deal is followed by the
 * client's purchase order, so as soon as sales marks the quotation Accepted
 * we surface a one-click upload that lands the PO file in this project's
 * Purchase Orders tab (kind='po'). Same direct-to-R2 three-phase flow the
 * project Files panel uses, so the byte upload never hits this app's body
 * limit.
 */
function PoUploadInline({ projectId }: { projectId: number }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const signRes = await fetch("/api/project-files/sign-upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            kind: "po",
            filename: file.name,
            mime: file.type || "application/octet-stream",
            size_bytes: file.size,
          }),
        });
        const signData = (await signRes.json()) as {
          signedUrl?: string;
          storage_path?: string;
          error?: string;
        };
        if (!signRes.ok || !signData.signedUrl || !signData.storage_path) {
          throw new Error(signData.error || `HTTP ${signRes.status}`);
        }
        const putRes = await fetch(signData.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
        const regRes = await fetch("/api/project-files", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            kind: "po",
            filename: file.name,
            mime: file.type || "application/octet-stream",
            size_bytes: file.size,
            storage_path: signData.storage_path,
          }),
        });
        const regData = (await regRes.json()) as {
          file?: unknown;
          error?: string;
        };
        if (!regRes.ok || !regData.file) {
          throw new Error(regData.error || `HTTP ${regRes.status}`);
        }
        setDone(true);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [projectId],
  );

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-emerald-800">
          {done
            ? "Client PO uploaded ✓"
            : "Won — upload the client's signed PO:"}
        </span>
        <label className="rounded-md bg-emerald-600 text-white px-3 py-1 text-xs font-semibold cursor-pointer hover:bg-emerald-700">
          {busy ? "Uploading…" : done ? "Replace PO" : "Upload signed PO"}
          <input
            type="file"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </label>
        <span className="text-[11px] text-emerald-700/80">
          Lands in the Purchase Orders tab · PDF / spreadsheet up to 25 MB
        </span>
      </div>
      {error && <div className="mt-1 text-[11px] text-red-700">{error}</div>}
    </div>
  );
}
