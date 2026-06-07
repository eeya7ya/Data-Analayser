"use client";

import { useCallback, useEffect, useState } from "react";
import ConvertToProjectDialog from "@/components/ConvertToProjectDialog";

/**
 * Dual-approval bar surfaced inside QuotationViewer. Shows the current
 * approval state and offers Approve / Reject buttons gated by the
 * caller's module roles.
 *
 * Server-side enforcement lives in /api/quotations/approve and /reject —
 * this UI only hides buttons the user can't action, but the API will
 * 403 either way. Admin users always see all three actions.
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
}

interface MeResponse {
  user: { id: number; role: string } | null;
  module_roles: Array<{ module: string; role: string }>;
}

export default function QuotationApprovalBar({
  quotationId,
  initial,
}: {
  quotationId: number;
  initial: ApprovalState;
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

  const isAdmin = me?.user?.role === "admin";
  const hasRole = (module: string, role: string) =>
    isAdmin ||
    !!me?.module_roles.some((r) => r.module === module && r.role === role);

  // 1.4A — sales-only approval. Presales does not sign off on quotations.
  const canApproveSales = hasRole("crm", "sales_manager");
  const canReject = canApproveSales;
  const canConvert =
    isAdmin || hasRole("crm", "sales") || hasRole("crm", "sales_manager");

  // 1.4C — presales → sales handoff. The author (or an admin) presses
  // "Send to sales" once the quotation is ready, and the sales person who
  // raised the RFQ either accepts or files a change request.
  const isOwner =
    !!me?.user?.id && state.owner_id !== null && me.user.id === state.owner_id;
  const isPresalesAuthor =
    isAdmin || isOwner || hasRole("crm", "presales") || hasRole("crm", "presales_manager");
  const canSendToSales = isPresalesAuthor && (isAdmin || isOwner);
  const sentToSales = !!state.sent_to_sales_at;
  const salesAccepted = !!state.sales_accepted_at;
  // The endpoint enforces "must be the lead creator", but the role check
  // here hides the button for users who have no chance of being it.
  const canSalesAccept =
    sentToSales &&
    !salesAccepted &&
    (isAdmin || hasRole("crm", "sales") || hasRole("crm", "sales_manager"));

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/approve", {
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

  async function salesAccept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/sales-accept", {
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
      "Mark this deal lost. Add a brief reason (the client passed, lost to a competitor, budget, …):",
    );
    if (reason === null) return;
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

  const fullyApproved = !!state.approved_at;
  const accepted = !!state.accepted_at || state.sales_outcome === "accepted";
  const rejected = !!state.rejected_at;
  const outcome = state.sales_outcome;
  const transferred = !!state.transferred_at;
  const heldPending = outcome === "held" && !transferred;

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
          {salesAccepted && <Pill tone="ok">Sales accepted</Pill>}
          {fullyApproved ? (
            <Pill tone="strong">Approved by sales manager</Pill>
          ) : (
            <Pill tone="muted">Awaiting sales manager sign-off</Pill>
          )}
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
          {canSalesAccept && (
            <button
              onClick={() => void salesAccept()}
              disabled={busy}
              title="Accept the quotation — presales gets a notification and it moves on to the sales manager"
              className="px-3 py-1 text-xs font-semibold rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
            >
              Approve quotation
            </button>
          )}
          {canApproveSales && !fullyApproved && (
            <button
              onClick={() => void approve()}
              disabled={busy}
              className="px-3 py-1 text-xs font-semibold rounded border border-magic-red text-magic-red hover:bg-magic-red hover:text-white disabled:opacity-50 transition-colors"
            >
              Approve quotation
            </button>
          )}
          {canReject && !rejected && (
            <button
              onClick={() => void reject()}
              disabled={busy}
              className="px-3 py-1 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
          )}
          {canConvert && fullyApproved && !rejected && !transferred && (
            <button
              onClick={() => setConverting(true)}
              disabled={busy}
              title="Push to execution now with site / contact details"
              className="px-3 py-1 text-xs font-semibold rounded bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
            >
              {converted ? "Pushed ✓ — push again" : "Push to execution"}
            </button>
          )}
        </div>
      </div>

      {/* V1.3D — sales records the client outcome. Accept / Reject can be
          marked any time; Hold for Execution stages the deal and (with a
          time set) auto-transfers it to the projects team. */}
      {canConvert && (
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
            <div className="flex flex-wrap items-center gap-2">
              {!transferred && (
                <>
                  <button
                    onClick={() => void markOutcome("accepted")}
                    disabled={outcomeBusy || !fullyApproved}
                    title={fullyApproved ? "Client accepted the quotation" : "Approve the quotation first"}
                    className="px-3 py-1 text-xs font-semibold rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                  >
                    Accepted
                  </button>
                  <button
                    onClick={() => void rejectOutcome()}
                    disabled={outcomeBusy}
                    className="px-3 py-1 text-xs font-semibold rounded border border-magic-border text-magic-ink/70 hover:bg-amber-50 hover:text-amber-800 hover:border-amber-300 disabled:opacity-50 transition-colors"
                  >
                    Rejected
                  </button>
                  <button
                    onClick={() => setHoldOpen((v) => !v)}
                    disabled={outcomeBusy || !fullyApproved}
                    title={fullyApproved ? "Stage for the projects team" : "Approve the quotation first"}
                    className="px-3 py-1 text-xs font-semibold rounded border border-magic-red text-magic-red hover:bg-magic-red hover:text-white disabled:opacity-50 transition-colors"
                  >
                    Hold for execution
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
          </div>
          {holdOpen && !transferred && (
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
