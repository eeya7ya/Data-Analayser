"use client";

import { useState } from "react";
import QuotationPreview, {
  QuotationHeader,
  QuotationItem,
} from "./QuotationPreview";
import { DEFAULT_TERMS } from "@/lib/quotationDraft";

interface SavedConfig {
  showPictures?: boolean;
  terms?: string[];
}

export default function QuotationViewer({
  row,
}: {
  row: Record<string, unknown>;
}) {
  const id = Number(row.id);
  const rawItems = (row.items_json as QuotationItem[]) || [];
  const initialItems: QuotationItem[] = rawItems.map((it) => ({
    ...it,
    system: it.system || it.brand || "General",
  }));
  const initialConfig = (row.config_json as SavedConfig) || {};
  const initialHeader: QuotationHeader = {
    ref: String(row.ref),
    project_name: String(row.project_name),
    client_name: (row.client_name as string) || "",
    client_email: (row.client_email as string) || "",
    client_phone: (row.client_phone as string) || "",
    sales_engineer: (row.sales_engineer as string) || "",
    prepared_by: (row.prepared_by as string) || "",
    site_name: String(row.site_name),
    tax_percent: Number(row.tax_percent || 0),
    date: new Date(String(row.created_at)).toLocaleDateString("en-GB"),
  };
  const initialTerms =
    Array.isArray(initialConfig.terms) && initialConfig.terms.length > 0
      ? initialConfig.terms
      : [...DEFAULT_TERMS];

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [header, setHeader] = useState<QuotationHeader>(initialHeader);
  const [items, setItems] = useState<QuotationItem[]>(initialItems);
  const [terms, setTerms] = useState<string[]>(initialTerms);
  const [showPictures, setShowPictures] = useState<boolean>(
    Boolean(initialConfig.showPictures),
  );

  // Baselines so "Cancel" can restore the original values.
  const [baselineHeader, setBaselineHeader] =
    useState<QuotationHeader>(initialHeader);
  const [baselineItems, setBaselineItems] =
    useState<QuotationItem[]>(initialItems);
  const [baselineTerms, setBaselineTerms] = useState<string[]>(initialTerms);
  const [baselineShowPictures, setBaselineShowPictures] = useState<boolean>(
    Boolean(initialConfig.showPictures),
  );

  function startEdit() {
    setBaselineHeader(header);
    setBaselineItems(items);
    setBaselineTerms(terms);
    setBaselineShowPictures(showPictures);
    setEditing(true);
  }

  function cancelEdit() {
    setHeader(baselineHeader);
    setItems(baselineItems);
    setTerms(baselineTerms);
    setShowPictures(baselineShowPictures);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    try {
      const subtotal = items.reduce(
        (a, it) =>
          a + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
        0,
      );
      const tax = (subtotal * (header.tax_percent || 0)) / 100;
      const totals = { subtotal, tax, total: subtotal + tax };
      const res = await fetch(`/api/quotations?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: header.ref,
          project_name: header.project_name || "Untitled Quotation",
          client_name: header.client_name ?? null,
          client_email: header.client_email ?? null,
          client_phone: header.client_phone ?? null,
          sales_engineer: header.sales_engineer ?? null,
          prepared_by: header.prepared_by ?? null,
          site_name: header.site_name,
          tax_percent: header.tax_percent,
          items,
          totals,
          config: { showPictures, terms },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setBaselineHeader(header);
      setBaselineItems(items);
      setBaselineTerms(terms);
      setBaselineShowPictures(showPictures);
      setEditing(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="no-print flex justify-end mb-3 gap-2">
        {editing ? (
          <>
            <label className="flex items-center gap-2 mr-2 text-xs text-magic-ink/70">
              <input
                type="checkbox"
                checked={showPictures}
                onChange={(e) => setShowPictures(e.target.checked)}
              />
              Picture column
            </label>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-md border border-magic-border px-4 py-2 text-sm hover:bg-magic-soft disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={startEdit}
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
          </>
        )}
      </div>
      <QuotationPreview
        header={header}
        items={items}
        setItems={editing ? setItems : undefined}
        setHeader={
          editing
            ? (patch) => setHeader((prev) => ({ ...prev, ...patch }))
            : undefined
        }
        editable={editing}
        showPictures={showPictures}
        terms={terms}
        setTerms={editing ? setTerms : undefined}
      />
    </div>
  );
}
