"use client";

import QuotationPreview, { QuotationItem } from "./QuotationPreview";
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
  const rawItems = (row.items_json as QuotationItem[]) || [];
  // Back-fill `system` for rows saved before grouping existed.
  const items: QuotationItem[] = rawItems.map((it) => ({
    ...it,
    system: it.system || it.brand || "General",
  }));
  const config = (row.config_json as SavedConfig) || {};
  const header = {
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

  return (
    <div>
      <div className="no-print flex justify-end mb-3 gap-2">
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
          Array.isArray(config.terms) && config.terms.length > 0
            ? config.terms
            : [...DEFAULT_TERMS]
        }
      />
    </div>
  );
}
