"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface PurchaseOrder {
  id: number;
  owner_id: number | null;
  quotation_id: number | null;
  folder_id: number | null;
  po_number: string;
  supplier: string | null;
  client_name: string | null;
  project_name: string | null;
  amount: string | number;
  currency: string;
  status: string;
  notes: string | null;
  issued_at: string | null;
  expected_at: string | null;
  created_at: string;
  updated_at: string;
  owner_username?: string | null;
  owner_display_name?: string | null;
  quotation_ref?: string | null;
  folder_name?: string | null;
}

interface QuotationLite {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
}

interface FolderLite {
  id: number;
  name: string;
}

type SortBy =
  | "created"
  | "updated"
  | "po_number"
  | "client_name"
  | "project_name"
  | "amount"
  | "status"
  | "issued_at"
  | "expected_at";
type SortDir = "asc" | "desc";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function formatAmount(raw: string | number, currency: string): string {
  const n = typeof raw === "number" ? raw : Number(raw) || 0;
  return `${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PurchaseOrdersClient({
  isAdmin,
  prefillQuotationId,
}: {
  isAdmin: boolean;
  /**
   * Optional quotation id to preselect in the create form. Supplied by the
   * server page when the user clicks "Convert to PO" on the quotation
   * viewer — that deep-links to `/purchase-orders?quotation=<id>`.
   */
  prefillQuotationId?: string | null;
}) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Quotations & folders for the "link to" selectors. Users may create POs
  // without linking, so these are optional.
  const [quotations, setQuotations] = useState<QuotationLite[]>([]);
  const [folders, setFolders] = useState<FolderLite[]>([]);

  // New-PO form state.
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [formPoNumber, setFormPoNumber] = useState("");
  const [formQuotationId, setFormQuotationId] = useState<string>("");
  const [formSupplier, setFormSupplier] = useState("");
  const [formClient, setFormClient] = useState("");
  const [formProject, setFormProject] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCurrency, setFormCurrency] = useState("JOD");
  const [formStatus, setFormStatus] = useState("open");
  const [formNotes, setFormNotes] = useState("");
  const [formIssuedAt, setFormIssuedAt] = useState("");
  const [formExpectedAt, setFormExpectedAt] = useState("");

  // Inline-edit state (one row at a time).
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState("open");
  const [editSupplier, setEditSupplier] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editExpectedAt, setEditExpectedAt] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  // Filter / sort state.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      fetch("/api/purchase-orders", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/quotations", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/folders", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([poRes, qRes, fRes]) => {
        if (cancelled) return;
        if (poRes?.error) {
          setLoadError(poRes.error);
          return;
        }
        setOrders((poRes?.purchaseOrders || []) as PurchaseOrder[]);
        setQuotations((qRes?.quotations || []) as QuotationLite[]);
        setFolders((fRes?.folders || []) as FolderLite[]);
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // Auto-prefill the form when the user picks a quotation so they don't
  // have to retype the client / project / amount — the whole point of
  // linking a PO to a quote is to inherit that context.
  useEffect(() => {
    if (!formQuotationId) return;
    const q = quotations.find((x) => String(x.id) === formQuotationId);
    if (!q) return;
    if (!formClient.trim()) setFormClient(q.client_name || "");
    if (!formProject.trim()) setFormProject(q.project_name || "");
  }, [formQuotationId, quotations, formClient, formProject]);

  // Honor `/purchase-orders?quotation=<id>` deep-links coming from the
  // "Convert to PO" button in the quotation viewer. We open the create
  // form with the quotation preselected so the user only has to type the
  // PO number + supplier.
  useEffect(() => {
    if (!prefillQuotationId) return;
    setShowCreate(true);
    setFormQuotationId(prefillQuotationId);
  }, [prefillQuotationId]);

  function resetForm() {
    setFormPoNumber("");
    setFormQuotationId("");
    setFormSupplier("");
    setFormClient("");
    setFormProject("");
    setFormAmount("");
    setFormCurrency("JOD");
    setFormStatus("open");
    setFormNotes("");
    setFormIssuedAt("");
    setFormExpectedAt("");
    setCreateErr(null);
  }

  async function createPo(e: React.FormEvent) {
    e.preventDefault();
    if (!formPoNumber.trim()) {
      setCreateErr("PO number is required");
      return;
    }
    setCreating(true);
    setCreateErr(null);
    try {
      const body: Record<string, unknown> = {
        po_number: formPoNumber.trim(),
        supplier: formSupplier.trim() || null,
        client_name: formClient.trim() || null,
        project_name: formProject.trim() || null,
        amount: formAmount ? Number(formAmount) : 0,
        currency: formCurrency.trim() || "JOD",
        status: formStatus,
        notes: formNotes.trim() || null,
        issued_at: formIssuedAt || null,
        expected_at: formExpectedAt || null,
      };
      if (formQuotationId) body.quotation_id = Number(formQuotationId);
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create PO");
      setOrders((prev) => [data.purchaseOrder, ...prev]);
      resetForm();
      setShowCreate(false);
    } catch (e) {
      setCreateErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(po: PurchaseOrder) {
    setEditingId(po.id);
    setEditStatus(po.status);
    setEditSupplier(po.supplier || "");
    setEditNotes(po.notes || "");
    setEditAmount(String(po.amount));
    setEditExpectedAt(po.expected_at ? po.expected_at.slice(0, 10) : "");
    setEditErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditErr(null);
  }

  async function saveEdit(id: number) {
    setSavingEdit(true);
    setEditErr(null);
    try {
      const res = await fetch(`/api/purchase-orders?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editStatus,
          supplier: editSupplier.trim() || null,
          notes: editNotes.trim() || null,
          amount: Number(editAmount) || 0,
          expected_at: editExpectedAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setOrders((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, ...data.purchaseOrder } : p,
        ),
      );
      setEditingId(null);
    } catch (e) {
      setEditErr((e as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function deletePo(id: number) {
    if (
      !confirm(
        "Move this purchase order to the trash? It can be restored later.",
      )
    )
      return;
    try {
      const res = await fetch(`/api/purchase-orders?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to delete");
        return;
      }
      setOrders((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = orders;
    if (statusFilter !== "all") {
      list = list.filter((p) => p.status === statusFilter);
    }
    if (q) {
      list = list.filter(
        (p) =>
          p.po_number.toLowerCase().includes(q) ||
          (p.client_name || "").toLowerCase().includes(q) ||
          (p.project_name || "").toLowerCase().includes(q) ||
          (p.supplier || "").toLowerCase().includes(q) ||
          (p.quotation_ref || "").toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "created":
          cmp =
            Date.parse(a.created_at || "") - Date.parse(b.created_at || "");
          break;
        case "updated":
          cmp =
            Date.parse(a.updated_at || "") - Date.parse(b.updated_at || "");
          break;
        case "po_number":
          cmp = a.po_number.localeCompare(b.po_number, undefined, {
            numeric: true,
          });
          break;
        case "client_name":
          cmp = (a.client_name || "").localeCompare(b.client_name || "");
          break;
        case "project_name":
          cmp = (a.project_name || "").localeCompare(b.project_name || "");
          break;
        case "amount":
          cmp = Number(a.amount) - Number(b.amount);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "issued_at":
          cmp =
            Date.parse(a.issued_at || "") - Date.parse(b.issued_at || "");
          break;
        case "expected_at":
          cmp =
            Date.parse(a.expected_at || "") - Date.parse(b.expected_at || "");
          break;
      }
      return cmp * dir;
    });
  }, [orders, search, statusFilter, sortBy, sortDir]);

  const totals = useMemo(() => {
    const byStatus = new Map<string, number>();
    let grand = 0;
    for (const p of filtered) {
      const amt = Number(p.amount) || 0;
      grand += amt;
      byStatus.set(p.status, (byStatus.get(p.status) || 0) + amt);
    }
    return { grand, byStatus };
  }, [filtered]);

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="px-4 py-3 text-sm text-red-600 bg-red-50 rounded-xl border border-red-200 flex items-start justify-between gap-3">
          <div className="min-w-0 break-words">
            <div className="font-semibold">Failed to load purchase orders.</div>
            <div className="text-xs text-red-600/80">{loadError}</div>
          </div>
          <button
            onClick={() => setReloadTick((t) => t + 1)}
            className="shrink-0 rounded-md bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PO #, client, project, supplier, or linked quotation…"
            className="w-full pl-10 pr-4 py-2 text-sm border border-magic-border rounded-xl focus:outline-none focus:ring-2 focus:ring-magic-red/30 bg-white"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-magic-ink/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-magic-border rounded-xl bg-white"
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-magic-ink/50 font-semibold">
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="px-2 py-2 text-xs border border-magic-border rounded-lg bg-white"
          >
            <option value="created">Created</option>
            <option value="updated">Last edited</option>
            <option value="po_number">PO number</option>
            <option value="client_name">Client</option>
            <option value="project_name">Project</option>
            <option value="amount">Amount</option>
            <option value="status">Status</option>
            <option value="issued_at">Issued date</option>
            <option value="expected_at">Expected date</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
            className="px-2 py-2 text-xs border border-magic-border rounded-lg bg-white text-magic-ink/70 hover:text-magic-red hover:border-magic-red/60"
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
        <button
          onClick={() => {
            setShowCreate((s) => !s);
            setCreateErr(null);
          }}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-magic-red text-white hover:bg-magic-red/90 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m8-8H4"
            />
          </svg>
          New PO
        </button>
      </div>

      {/* Summary chips */}
      {!loading && orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-magic-header px-3 py-1 font-semibold text-magic-ink/70">
            {filtered.length} PO{filtered.length !== 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-magic-red/10 text-magic-red px-3 py-1 font-semibold">
            Total: {totals.grand.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          {[...totals.byStatus.entries()].map(([status, amt]) => (
            <span
              key={status}
              className="rounded-full bg-white border border-magic-border px-3 py-1 text-magic-ink/70"
            >
              {status}:{" "}
              {amt.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          ))}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={createPo}
          className="rounded-2xl border border-magic-border bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
        >
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60 md:col-span-1">
            PO number *
            <input
              type="text"
              value={formPoNumber}
              onChange={(e) => setFormPoNumber(e.target.value)}
              required
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
              placeholder="PO-2026-0001"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Linked quotation
            <select
              value={formQuotationId}
              onChange={(e) => setFormQuotationId(e.target.value)}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink bg-white"
            >
              <option value="">— (none)</option>
              {quotations.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.ref} · {q.project_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Supplier
            <input
              type="text"
              value={formSupplier}
              onChange={(e) => setFormSupplier(e.target.value)}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Client
            <input
              type="text"
              value={formClient}
              onChange={(e) => setFormClient(e.target.value)}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Project
            <input
              type="text"
              value={formProject}
              onChange={(e) => setFormProject(e.target.value)}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Amount
            <div className="flex gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                className="flex-1 rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
                placeholder="0.00"
              />
              <input
                type="text"
                value={formCurrency}
                onChange={(e) => setFormCurrency(e.target.value.toUpperCase())}
                maxLength={6}
                className="w-16 rounded-md border border-magic-border px-2 py-2 text-sm text-magic-ink"
              />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Status
            <select
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value)}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Issued date
            <input
              type="date"
              value={formIssuedAt}
              onChange={(e) => setFormIssuedAt(e.target.value)}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60">
            Expected date
            <input
              type="date"
              value={formExpectedAt}
              onChange={(e) => setFormExpectedAt(e.target.value)}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-magic-ink/60 md:col-span-3">
            Notes
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={2}
              className="rounded-md border border-magic-border px-3 py-2 text-sm text-magic-ink"
            />
          </label>
          <div className="md:col-span-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create PO"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                resetForm();
              }}
              className="px-3 py-2 text-sm text-magic-ink/60 hover:text-magic-ink"
            >
              Cancel
            </button>
            {createErr && (
              <span className="text-xs text-red-600">{createErr}</span>
            )}
          </div>
        </form>
      )}

      {/* Table */}
      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-xl border border-magic-border bg-white animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-magic-border bg-white p-6 text-center text-magic-ink/50">
          {orders.length === 0
            ? "No purchase orders yet. Click + New PO above to create one, or convert a quotation into a PO."
            : "No POs match your filters."}
        </div>
      ) : (
        <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-magic-header text-magic-red text-xs uppercase">
              <tr>
                <th className="p-3 text-left">PO #</th>
                <th className="p-3 text-left">Linked quote</th>
                <th className="p-3 text-left">Client / Project</th>
                <th className="p-3 text-left">Supplier</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Expected</th>
                {isAdmin && <th className="p-3 text-left">Owner</th>}
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((po) => {
                const isEditing = editingId === po.id;
                const folder = folders.find((f) => f.id === po.folder_id);
                return (
                  <tr
                    key={po.id}
                    className={`border-t border-magic-border ${
                      isEditing ? "bg-amber-50/50" : ""
                    }`}
                  >
                    <td className="p-3 font-mono text-magic-ink">
                      {po.po_number}
                      <div className="text-[11px] text-magic-ink/40">
                        {formatDate(po.created_at)}
                      </div>
                    </td>
                    <td className="p-3">
                      {po.quotation_id && po.quotation_ref ? (
                        <Link
                          href={`/quotation?id=${po.quotation_id}`}
                          className="text-magic-red hover:underline font-mono text-xs"
                        >
                          {po.quotation_ref}
                        </Link>
                      ) : (
                        <span className="text-magic-ink/30 text-xs">—</span>
                      )}
                      {folder && (
                        <div className="text-[11px] text-magic-ink/50 truncate">
                          {folder.name}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-magic-ink">
                        {po.client_name || "—"}
                      </div>
                      <div className="text-xs text-magic-ink/60 truncate">
                        {po.project_name || "—"}
                      </div>
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editSupplier}
                          onChange={(e) => setEditSupplier(e.target.value)}
                          className="w-full rounded-md border border-magic-border px-2 py-1 text-sm"
                        />
                      ) : (
                        po.supplier || (
                          <span className="text-magic-ink/30">—</span>
                        )
                      )}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-28 rounded-md border border-magic-border px-2 py-1 text-sm text-right"
                        />
                      ) : (
                        formatAmount(po.amount, po.currency)
                      )}
                    </td>
                    <td className="p-3">
                      {isEditing ? (
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value)}
                          className="rounded-md border border-magic-border px-2 py-1 text-sm bg-white"
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                            po.status === "fulfilled"
                              ? "bg-green-100 text-green-700"
                              : po.status === "cancelled"
                                ? "bg-gray-100 text-gray-500"
                                : po.status === "in_progress"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-magic-red/10 text-magic-red"
                          }`}
                        >
                          {po.status.replace("_", " ")}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-magic-ink/70">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editExpectedAt}
                          onChange={(e) => setEditExpectedAt(e.target.value)}
                          className="rounded-md border border-magic-border px-2 py-1 text-xs"
                        />
                      ) : (
                        formatDate(po.expected_at)
                      )}
                    </td>
                    {isAdmin && (
                      <td className="p-3 text-xs text-magic-ink/60">
                        {po.owner_display_name?.trim() ||
                          po.owner_username ||
                          "—"}
                      </td>
                    )}
                    <td className="p-3 text-right whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => saveEdit(po.id)}
                            disabled={savingEdit}
                            className="rounded-md bg-green-600 text-white px-3 py-1 text-xs font-semibold hover:bg-green-700 disabled:opacity-60"
                          >
                            {savingEdit ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-md border border-magic-border px-3 py-1 text-xs hover:bg-gray-100"
                          >
                            Cancel
                          </button>
                          {editErr && (
                            <span className="text-xs text-red-600">
                              {editErr}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => startEdit(po)}
                            className="text-blue-600 text-xs hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deletePo(po.id)}
                            className="text-red-500 text-xs hover:underline"
                          >
                            Trash
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
