"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface CatalogueItem {
  id: number;
  vendor: string;
  category: string;
  sub_category: string | null;
  model: string;
  description: string;
  description_locked: boolean;
  currency: string;
  price_dpp: number | string | null;
  price_si: number | string | null;
  price_end_user: number | string | null;
  specs: Record<string, unknown> | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorFacet {
  vendor: string;
  category: string;
  n: number;
}

interface RowDiff {
  rowNumber: number;
  vendor: string;
  category: string;
  model: string;
  kind: "insert" | "update" | "unchanged" | "invalid";
  errors?: string[];
  oldPriceSi?: number | null;
  newPriceSi?: number | null;
  oldPriceDpp?: number | null;
  newPriceDpp?: number | null;
  oldPriceEndUser?: number | null;
  newPriceEndUser?: number | null;
  priceChangePct?: number | null;
}

interface UploadResponse {
  mode: "dry-run" | "commit";
  summary: {
    total: number;
    inserts: number;
    updates: number;
    unchanged: number;
    invalid: number;
  };
  diffs: RowDiff[];
  error?: string;
}

type Tab = "browse" | "upload" | "tools";

function fmtPrice(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

export default function CatalogueManager({
  initialItems,
  initialTotal,
  facets,
}: {
  initialItems: CatalogueItem[];
  initialTotal: number;
  facets: VendorFacet[];
}) {
  const [tab, setTab] = useState<Tab>("browse");

  return (
    <div className="space-y-6">
      <nav className="flex gap-2 border-b border-magic-border">
        {[
          { id: "browse", label: "Browse & Edit" },
          { id: "upload", label: "Upload Excel" },
          { id: "tools", label: "Bulk Tools" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
              tab === t.id
                ? "border-magic-red text-magic-red"
                : "border-transparent text-magic-ink/70 hover:text-magic-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "browse" && (
        <BrowseTab
          initialItems={initialItems}
          initialTotal={initialTotal}
          facets={facets}
        />
      )}
      {tab === "upload" && <UploadTab />}
      {tab === "tools" && <ToolsTab />}
    </div>
  );
}

// ─── Browse & Edit ──────────────────────────────────────────────────────────

function BrowseTab({
  initialItems,
  initialTotal,
  facets,
}: {
  initialItems: CatalogueItem[];
  initialTotal: number;
  facets: VendorFacet[];
}) {
  const [items, setItems] = useState<CatalogueItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<CatalogueItem | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (vendor) params.set("vendor", vendor);
      if (category) params.set("category", category);
      if (q) params.set("q", q);
      params.set("active", showInactive ? "false" : "true");
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await fetch(`/api/admin/catalogue/items?${params}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } finally {
      setLoading(false);
    }
  }, [vendor, category, q, page, pageSize, showInactive]);

  // Re-query whenever filters change.
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      load();
    }, 250);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [load]);

  const categoriesForVendor = useMemo(() => {
    const set = new Map<string, number>();
    for (const f of facets) {
      if (!vendor || f.vendor === vendor) {
        set.set(f.category, (set.get(f.category) || 0) + f.n);
      }
    }
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [facets, vendor]);

  const vendors = useMemo(() => {
    const set = new Map<string, number>();
    for (const f of facets) {
      set.set(f.vendor, (set.get(f.vendor) || 0) + f.n);
    }
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [facets]);

  async function softDelete(id: number) {
    if (!confirm("Soft-delete this item? It can be restored later.")) return;
    await fetch(`/api/admin/catalogue/items?id=${id}`, { method: "DELETE" });
    await load();
  }

  async function hardDelete(item: CatalogueItem) {
    const typed = prompt(
      `Permanently delete ${item.vendor} ${item.model}?\nType DELETE to confirm.`,
    );
    if (typed !== "DELETE") return;
    await fetch(`/api/admin/catalogue/items?id=${item.id}&hard=1`, {
      method: "DELETE",
    });
    await load();
  }

  async function restore(id: number) {
    await fetch(`/api/admin/catalogue/items?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-magic-border bg-white p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <select
          className="rounded-md border border-magic-border px-3 py-2 text-sm"
          value={vendor}
          onChange={(e) => {
            setPage(1);
            setVendor(e.target.value);
            setCategory("");
          }}
        >
          <option value="">All vendors</option>
          {vendors.map(([v, n]) => (
            <option key={v} value={v}>
              {v} ({n})
            </option>
          ))}
        </select>
        <select
          className="rounded-md border border-magic-border px-3 py-2 text-sm"
          value={category}
          onChange={(e) => {
            setPage(1);
            setCategory(e.target.value);
          }}
        >
          <option value="">All categories</option>
          {categoriesForVendor.map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </select>
        <input
          className="md:col-span-2 rounded-md border border-magic-border px-3 py-2 text-sm"
          placeholder="Search vendor / category / model / spec…"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <label className="flex items-center gap-2 text-xs text-magic-ink/70">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show soft-deleted
        </label>
      </div>

      <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 text-xs text-magic-ink/70 bg-magic-soft/30">
          <span>
            {loading ? "Loading…" : `${total} items`} · page {page}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border border-magic-border px-2 py-0.5 disabled:opacity-40"
            >
              ◀
            </button>
            <button
              disabled={items.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-magic-border px-2 py-0.5 disabled:opacity-40"
            >
              ▶
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-magic-header text-magic-red text-xs uppercase">
              <tr>
                <th className="p-2 text-left">Vendor</th>
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-left">Model</th>
                <th className="p-2 text-right">DPP</th>
                <th className="p-2 text-right">SI</th>
                <th className="p-2 text-right">End user</th>
                <th className="p-2 text-left">Currency</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className={`border-t border-magic-border ${
                    it.active ? "" : "opacity-50"
                  }`}
                >
                  <td className="p-2 whitespace-nowrap">{it.vendor}</td>
                  <td className="p-2 whitespace-nowrap">{it.category}</td>
                  <td className="p-2 font-mono text-xs">{it.model}</td>
                  <td className="p-2 text-right">{fmtPrice(it.price_dpp)}</td>
                  <td className="p-2 text-right">{fmtPrice(it.price_si)}</td>
                  <td className="p-2 text-right">
                    {fmtPrice(it.price_end_user)}
                  </td>
                  <td className="p-2">{it.currency}</td>
                  <td className="p-2 max-w-md">
                    <div
                      className="line-clamp-2 text-xs text-magic-ink/80"
                      title={it.description}
                    >
                      {it.description_locked && (
                        <span className="text-amber-600 mr-1" title="locked">
                          🔒
                        </span>
                      )}
                      {it.description || (
                        <span className="text-magic-ink/40 italic">empty</span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 whitespace-nowrap text-right space-x-2">
                    <button
                      onClick={() => setEditing(it)}
                      className="text-xs text-magic-ink hover:underline"
                    >
                      Edit
                    </button>
                    {it.active ? (
                      <>
                        <button
                          onClick={() => softDelete(it.id)}
                          className="text-xs text-amber-600 hover:underline"
                        >
                          Soft delete
                        </button>
                        <button
                          onClick={() => hardDelete(it)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Hard
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => restore(it.id)}
                        className="text-xs text-emerald-600 hover:underline"
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={9}
                    className="p-6 text-center text-magic-ink/40 text-xs"
                  >
                    No items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditModal
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ─── Edit modal ─────────────────────────────────────────────────────────────

function EditModal({
  item,
  onClose,
  onSaved,
}: {
  item: CatalogueItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(item.description);
  const [priceDpp, setPriceDpp] = useState(
    item.price_dpp === null ? "" : String(item.price_dpp),
  );
  const [priceSi, setPriceSi] = useState(
    item.price_si === null ? "" : String(item.price_si),
  );
  const [priceEnd, setPriceEnd] = useState(
    item.price_end_user === null ? "" : String(item.price_end_user),
  );
  const [currency, setCurrency] = useState(item.currency);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        currency,
        price_dpp: priceDpp === "" ? null : Number(priceDpp),
        price_si: priceSi === "" ? null : Number(priceSi),
        price_end_user: priceEnd === "" ? null : Number(priceEnd),
      };
      if (description !== item.description) body.description = description;
      const res = await fetch(`/api/admin/catalogue/items?id=${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    setRegenLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        "/api/admin/catalogue/regenerate-descriptions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [item.id], force: true }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || "regenerate failed");
      }
      // Poll for completion.
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const pres = await fetch(
          `/api/admin/catalogue/jobs/${data.jobId}`,
        );
        const pdata = await pres.json();
        if (pdata.job?.status === "done") {
          // Fetch the fresh row to preview the new description.
          const ires = await fetch(
            `/api/admin/catalogue/items?q=${encodeURIComponent(
              item.model,
            )}&vendor=${encodeURIComponent(item.vendor)}&pageSize=1`,
          );
          const idata = await ires.json();
          const fresh = (idata.items || []).find(
            (x: CatalogueItem) => x.id === item.id,
          );
          if (fresh) setPreview(fresh.description);
          break;
        }
        if (pdata.job?.status === "error") {
          throw new Error(pdata.job.error || "job failed");
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRegenLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-magic-ink">
              {item.vendor} · {item.model}
            </h3>
            <p className="text-xs text-magic-ink/60">
              {item.category} {item.sub_category && `· ${item.sub_category}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <label className="text-xs text-magic-ink/70">
            Currency
            <input
              className="mt-1 w-full rounded-md border border-magic-border px-2 py-1 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </label>
          <label className="text-xs text-magic-ink/70">
            DPP
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-magic-border px-2 py-1 text-sm"
              value={priceDpp}
              onChange={(e) => setPriceDpp(e.target.value)}
            />
          </label>
          <label className="text-xs text-magic-ink/70">
            SI
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-magic-border px-2 py-1 text-sm"
              value={priceSi}
              onChange={(e) => setPriceSi(e.target.value)}
            />
          </label>
          <label className="text-xs text-magic-ink/70">
            End user
            <input
              type="number"
              className="mt-1 w-full rounded-md border border-magic-border px-2 py-1 text-sm"
              value={priceEnd}
              onChange={(e) => setPriceEnd(e.target.value)}
            />
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-magic-ink/70">
              Description {item.description_locked && "🔒"}
            </label>
            <button
              onClick={regenerate}
              disabled={regenLoading}
              className="text-xs text-magic-red hover:underline disabled:opacity-40"
            >
              {regenLoading ? "Generating…" : "Regenerate with AI"}
            </button>
          </div>
          <textarea
            rows={6}
            className="w-full rounded-md border border-magic-border px-3 py-2 text-sm font-mono"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {preview && (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-700 mb-1">
                AI preview — click Accept to replace above
              </div>
              <div className="text-sm text-magic-ink whitespace-pre-wrap">
                {preview}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => {
                    setDescription(preview);
                    setPreview(null);
                  }}
                  className="rounded-md bg-emerald-600 text-white px-3 py-1 text-xs"
                >
                  Accept
                </button>
                <button
                  onClick={() => setPreview(null)}
                  className="rounded-md border border-magic-border px-3 py-1 text-xs"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>

        {item.specs && Object.keys(item.specs).length > 0 && (
          <details className="rounded-md border border-magic-border p-2">
            <summary className="cursor-pointer text-xs text-magic-ink/70">
              Specs ({Object.keys(item.specs).length})
            </summary>
            <pre className="text-xs font-mono mt-2 max-h-48 overflow-y-auto">
              {JSON.stringify(item.specs, null, 2)}
            </pre>
          </details>
        )}

        {err && <div className="text-xs text-red-600">{err}</div>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-magic-border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={save}
            className="rounded-md bg-magic-red text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Upload tab ─────────────────────────────────────────────────────────────

function UploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadResponse | null>(null);
  const [committing, setCommitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runDryRun() {
    if (!file) return;
    setLoading(true);
    setErr(null);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/catalogue/upload", {
        method: "POST",
        body: fd,
      });
      const data: UploadResponse = await res.json();
      if (!res.ok) throw new Error(data.error || "upload failed");
      setPreview(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!file || !preview) return;
    const totalChanges =
      preview.summary.inserts + preview.summary.updates;
    const typed = prompt(
      `Type COMMIT to apply ${totalChanges} changes (${preview.summary.inserts} new, ${preview.summary.updates} updated).`,
    );
    if (typed !== "COMMIT") return;
    setCommitting(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/catalogue/upload?commit=1", {
        method: "POST",
        body: fd,
      });
      const data: UploadResponse = await res.json();
      if (!res.ok) throw new Error(data.error || "commit failed");
      setPreview(data);
      alert(
        `Committed. ${data.summary.inserts} inserts, ${data.summary.updates} updates.`,
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-magic-border bg-white p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-magic-ink">
              Upload Excel workbook
            </h3>
            <p className="text-xs text-magic-ink/60">
              Uploads run in dry-run mode first — you always see a full diff
              before anything is written.
            </p>
          </div>
          <a
            href="/api/admin/catalogue/template"
            className="rounded-md bg-magic-ink text-white px-3 py-2 text-xs font-semibold"
          >
            Download template
          </a>
        </div>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setPreview(null);
          }}
          className="text-sm"
        />
        <div className="flex gap-2">
          <button
            disabled={!file || loading}
            onClick={runDryRun}
            className="rounded-md bg-magic-red text-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {loading ? "Parsing…" : "Dry run preview"}
          </button>
          {preview && preview.mode === "dry-run" && (
            <button
              disabled={committing}
              onClick={commit}
              className="rounded-md bg-emerald-600 text-white px-3 py-2 text-sm font-semibold disabled:opacity-40"
            >
              {committing ? "Committing…" : "Apply changes"}
            </button>
          )}
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>

      {preview && <PreviewTable preview={preview} />}
    </div>
  );
}

function PreviewTable({ preview }: { preview: UploadResponse }) {
  const [filter, setFilter] = useState<
    "all" | "insert" | "update" | "unchanged" | "invalid"
  >("all");
  const visible = useMemo(
    () =>
      preview.diffs.filter((d) => filter === "all" || d.kind === filter),
    [preview.diffs, filter],
  );
  return (
    <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-magic-soft/30 text-xs">
        <div className="flex gap-4 font-semibold">
          <span>Total: {preview.summary.total}</span>
          <span className="text-emerald-700">
            New: {preview.summary.inserts}
          </span>
          <span className="text-amber-700">
            Updates: {preview.summary.updates}
          </span>
          <span className="text-magic-ink/60">
            Unchanged: {preview.summary.unchanged}
          </span>
          <span className="text-red-700">
            Invalid: {preview.summary.invalid}
          </span>
        </div>
        <select
          value={filter}
          onChange={(e) =>
            setFilter(
              e.target.value as "all" | "insert" | "update" | "unchanged" | "invalid",
            )
          }
          className="rounded border border-magic-border px-2 py-0.5 text-xs"
        >
          <option value="all">All</option>
          <option value="insert">New</option>
          <option value="update">Updates</option>
          <option value="unchanged">Unchanged</option>
          <option value="invalid">Invalid</option>
        </select>
      </div>
      <div className="overflow-x-auto max-h-[60vh]">
        <table className="w-full text-xs">
          <thead className="bg-magic-header text-magic-red uppercase">
            <tr>
              <th className="p-2 text-left">Row</th>
              <th className="p-2 text-left">Kind</th>
              <th className="p-2 text-left">Vendor</th>
              <th className="p-2 text-left">Category</th>
              <th className="p-2 text-left">Model</th>
              <th className="p-2 text-right">Old SI</th>
              <th className="p-2 text-right">New SI</th>
              <th className="p-2 text-right">Δ%</th>
              <th className="p-2 text-left">Errors</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr
                key={d.rowNumber}
                className={`border-t border-magic-border ${
                  d.kind === "invalid"
                    ? "bg-red-50"
                    : d.kind === "update"
                      ? "bg-amber-50"
                      : d.kind === "insert"
                        ? "bg-emerald-50"
                        : ""
                }`}
              >
                <td className="p-2">{d.rowNumber}</td>
                <td className="p-2">{d.kind}</td>
                <td className="p-2">{d.vendor}</td>
                <td className="p-2">{d.category}</td>
                <td className="p-2 font-mono">{d.model}</td>
                <td className="p-2 text-right">{fmtPrice(d.oldPriceSi)}</td>
                <td className="p-2 text-right">{fmtPrice(d.newPriceSi)}</td>
                <td
                  className={`p-2 text-right ${
                    d.priceChangePct && d.priceChangePct > 0
                      ? "text-red-600"
                      : d.priceChangePct && d.priceChangePct < 0
                        ? "text-emerald-700"
                        : "text-magic-ink/40"
                  }`}
                >
                  {fmtPct(d.priceChangePct)}
                </td>
                <td className="p-2 text-red-700">
                  {d.errors?.join("; ") || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Bulk tools tab ─────────────────────────────────────────────────────────

function ToolsTab() {
  const [vendor, setVendor] = useState("");
  const [force, setForce] = useState(false);
  const [job, setJob] = useState<{
    id: number;
    status: string;
    total: number;
    done: number;
    error: string | null;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setErr(null);
    setJob(null);
    try {
      const res = await fetch(
        "/api/admin/catalogue/regenerate-descriptions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendor: vendor || undefined,
            force,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      if (!data.jobId) {
        alert(data.message || "Nothing to regenerate.");
        return;
      }
      setJob({
        id: data.jobId,
        status: "pending",
        total: data.total,
        done: 0,
        error: null,
      });
      poll(data.jobId);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function poll(id: number) {
    for (let i = 0; i < 2000; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await fetch(`/api/admin/catalogue/jobs/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error);
        return;
      }
      setJob({
        id: data.job.id,
        status: data.job.status,
        total: data.job.total,
        done: data.job.done,
        error: data.job.error,
      });
      if (data.job.status === "done" || data.job.status === "error") return;
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-magic-border bg-white p-6 space-y-3">
        <h3 className="font-semibold text-magic-ink">
          Regenerate descriptions (Groq)
        </h3>
        <p className="text-xs text-magic-ink/60">
          Uses <code>llama-3.1-8b-instant</code> to generate professional
          product copy from the full spec payload. Batches of 8 per request to
          stay under the free-tier rate limit. Locked rows are skipped unless
          Force is checked.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <input
            placeholder="vendor (optional)"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            className="rounded-md border border-magic-border px-3 py-2 text-sm"
          />
          <label className="flex items-center gap-2 text-xs text-magic-ink/70">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            Force (ignore description_locked)
          </label>
          <button
            onClick={start}
            className="rounded-md bg-magic-red text-white px-3 py-2 text-sm font-semibold"
          >
            Start
          </button>
        </div>
        {job && (
          <div className="rounded-md bg-magic-soft/40 p-3 text-xs">
            <div>
              Job #{job.id} · {job.status} · {job.done}/{job.total}
            </div>
            <div className="h-2 rounded-full bg-white mt-2 overflow-hidden">
              <div
                className="h-full bg-magic-red"
                style={{
                  width: `${job.total > 0 ? (job.done / job.total) * 100 : 0}%`,
                }}
              />
            </div>
            {job.error && (
              <div className="text-red-600 mt-2">{job.error}</div>
            )}
          </div>
        )}
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>
    </div>
  );
}
