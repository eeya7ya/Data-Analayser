"use client";

import { useRouter } from "next/navigation";
import QuotationPreview, {
  QuotationItem,
  QuotationExtraColumn,
} from "./QuotationPreview";
import { DEFAULT_TERMS } from "@/lib/quotationDraft";

interface SavedConfig {
  showPictures?: boolean;
  terms?: string[];
  salesPhone?: string;
  extraColumns?: QuotationExtraColumn[];
  scopeIntro?: string;
}

export default function QuotationViewer({
  row,
}: {
  row: Record<string, unknown>;
}) {
  const router = useRouter();
  const id = Number(row.id);
  const rawItems = (row.items_json as QuotationItem[]) || [];
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
    sales_phone: config.salesPhone || "",
    prepared_by: (row.prepared_by as string) || "",
    site_name: String(row.site_name),
    tax_percent: Number(row.tax_percent || 0),
    date: new Date(String(row.created_at)).toLocaleDateString("en-GB"),
    extra_columns: Array.isArray(config.extraColumns)
      ? config.extraColumns
      : [],
    scope_intro: config.scopeIntro || "",
  };

  return (
    <div>
      <div className="no-print flex justify-end mb-3 gap-2">
        <button
          onClick={() => router.push(`/designer?id=${id}`)}
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
