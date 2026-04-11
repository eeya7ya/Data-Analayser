"use client";

import { useRouter } from "next/navigation";
import QuotationPreview, {
  QuotationItem,
  QuotationExtraColumn,
} from "./QuotationPreview";
import { DEFAULT_TERMS, termsMatchBuiltInDefault } from "@/lib/quotationDraft";
import type { AppSettings } from "@/lib/settings";

interface SavedConfig {
  showPictures?: boolean;
  terms?: string[];
  salesPhone?: string;
  extraColumns?: QuotationExtraColumn[];
  scopeIntro?: string;
  designEng?: string;
  includeTax?: boolean;
  taxInclusive?: boolean;
}

export default function QuotationViewer({
  row,
  appSettings,
}: {
  row: Record<string, unknown>;
  appSettings: AppSettings;
}) {
  const fallbackTerms =
    appSettings.defaultTerms && appSettings.defaultTerms.length > 0
      ? appSettings.defaultTerms
      : DEFAULT_TERMS;
  const router = useRouter();
  const id = Number(row.id);
  // `items_json` comes straight from a jsonb column. Normally that decodes to
  // an array, but legacy/corrupt rows can surface an object or a JSON string,
  // either of which would make `.map` throw and crash the whole viewer.
  const rawItemsUnknown: unknown = row.items_json;
  const parsedItems: unknown =
    typeof rawItemsUnknown === "string"
      ? (() => {
          try {
            return JSON.parse(rawItemsUnknown);
          } catch {
            return [];
          }
        })()
      : rawItemsUnknown;
  const rawItems: QuotationItem[] = Array.isArray(parsedItems)
    ? (parsedItems as QuotationItem[])
    : [];
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
    design_engineer: config.designEng || "",
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
          // Saved quotations that still carry the pre-admin built-in list
          // should yield to the admin-edited presets (fallbackTerms). Genuine
          // per-quotation customisations (anything different from the
          // built-in list) keep showing what the author saved.
          Array.isArray(config.terms) &&
          config.terms.length > 0 &&
          !termsMatchBuiltInDefault(config.terms)
            ? config.terms
            : [...fallbackTerms]
        }
        includeTax={config.includeTax !== false}
        taxInclusive={Boolean(config.taxInclusive)}
        footerText={appSettings.footerText}
      />
    </div>
  );
}
