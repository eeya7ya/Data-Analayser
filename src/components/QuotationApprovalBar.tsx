"use client";

import { useCallback, useEffect, useState } from "react";

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

  const canApproveSales = hasRole("crm", "sales_manager");
  const canApprovePresales = hasRole("crm", "presales_manager");
  const canReject = canApproveSales || canApprovePresales;

  async function approve(side: "sales" | "presales") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quotations/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: quotationId, side }),
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

  const salesApproved = !!state.sales_approved_at;
  const presalesApproved = !!state.presales_approved_at;
  const fullyApproved = !!state.approved_at;
  const accepted = !!state.accepted_at;
  const rejected = !!state.rejected_at;

  return (
    <div className="no-print rounded-xl border border-magic-border bg-white px-4 py-3 mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-magic-ink/70">Approval:</span>
          <Pill tone={salesApproved ? "ok" : "muted"}>
            Sales {salesApproved ? "✓" : "pending"}
          </Pill>
          <Pill tone={presalesApproved ? "ok" : "muted"}>
            Presales {presalesApproved ? "✓" : "pending"}
          </Pill>
          {fullyApproved && <Pill tone="strong">Fully approved</Pill>}
          {accepted && <Pill tone="strong">Client accepted</Pill>}
          {rejected && (
            <Pill tone="warn">
              Rejected
              {state.rejected_reason && `: ${state.rejected_reason.slice(0, 60)}`}
            </Pill>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canApproveSales && !salesApproved && (
            <button
              onClick={() => void approve("sales")}
              disabled={busy}
              className="px-3 py-1 text-xs font-semibold rounded border border-magic-red text-magic-red hover:bg-magic-red hover:text-white disabled:opacity-50 transition-colors"
            >
              Approve as Sales
            </button>
          )}
          {canApprovePresales && !presalesApproved && (
            <button
              onClick={() => void approve("presales")}
              disabled={busy}
              className="px-3 py-1 text-xs font-semibold rounded border border-magic-red text-magic-red hover:bg-magic-red hover:text-white disabled:opacity-50 transition-colors"
            >
              Approve as Presales
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
        </div>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
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
