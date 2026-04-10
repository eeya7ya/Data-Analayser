"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import QuotationPreview, {
  QuotationItem,
  QuotationExtraColumn,
} from "./QuotationPreview";
import {
  DEFAULT_TERMS,
  loadDraft,
  saveDraft,
  clearDraft,
  loadDesignEngineerPref,
  saveDesignEngineerPref,
  saveEditingContext,
  PRICING_FACTORS,
  PRICING_LABELS,
  type PricingCategory,
} from "@/lib/quotationDraft";
import { computeQuotationTotals } from "@/lib/quotationTotals";

export interface ExistingQuotation {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  sales_engineer: string | null;
  prepared_by: string | null;
  site_name: string;
  tax_percent: number;
  items_json: QuotationItem[];
  config_json: {
    showPictures?: boolean;
    terms?: string[];
    salesPhone?: string;
    extraColumns?: QuotationExtraColumn[];
    scopeIntro?: string;
    designEng?: string;
    pricingCategory?: PricingCategory;
  };
}

export default function Designer({
  user,
  existing,
}: {
  user: SessionUser;
  existing?: ExistingQuotation;
}) {
  const router = useRouter();
  const editMode = !!existing;
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [salesEng, setSalesEng] = useState("ENG. Yahya Khaled");
  const [salesPhone, setSalesPhone] = useState("+962 795172566");
  const [preparedBy, setPreparedBy] = useState(user.username);
  const [refCode, setRefCode] = useState("");
  const [siteName, setSiteName] = useState("");
  const [taxPercent, setTaxPercent] = useState(16);
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [showPictures, setShowPictures] = useState(false);
  const [terms, setTerms] = useState<string[]>([...DEFAULT_TERMS]);
  const [extraColumns, setExtraColumns] = useState<QuotationExtraColumn[]>([]);
  const [scopeIntro, setScopeIntro] = useState("");
  const [designEng, setDesignEngState] = useState("");
  const [pricingCategory, setPricingCategoryState] = useState<PricingCategory>("si");
  const hydratedRef = useRef(false);

  function setDesignEng(value: string) {
    setDesignEngState(value);
    saveDesignEngineerPref(value);
  }

  // ── Pricing category switching ────────────────────────────────────────────
  // When the user picks a new preset category (SI / DPP / End-user) we
  // recompute every row's unit_price from its stored price_si baseline.
  // Switching TO "manual" leaves prices untouched so the user can edit
  // freely. Switching FROM "manual" re-applies the chosen factor.
  function setPricingCategory(next: PricingCategory) {
    setPricingCategoryState(next);

    if (next === "manual") return; // leave prices as-is

    const factor = PRICING_FACTORS[next];
    setItems((cur) =>
      cur.map((it) => {
        // Use stored SI price if available, otherwise treat current
        // unit_price as the SI baseline (backwards-compat with old items).
        const base = it.price_si ?? it.unit_price;
        return {
          ...it,
          price_si: base,
          unit_price: Number((base * factor).toFixed(2)),
        };
      }),
    );
  }

  // ── Hydrate state on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (existing) {
      saveEditingContext({
        id: existing.id,
        ref: existing.ref,
        projectName: existing.project_name || "",
      });

      const baseItems = (Array.isArray(existing.items_json)
        ? existing.items_json
        : []
      ).map((it) => ({
        ...it,
        system: it.system || it.brand || "General",
        price_si: it.price_si ?? it.unit_price,
      }));

      const draft = loadDraft();
      const stagedItems =
        Array.isArray(draft.items) && draft.items.length > 0
          ? draft.items.map((it) => ({
              ...it,
              system: it.system || it.brand || "General",
              price_si: it.price_si ?? it.unit_price,
            }))
          : [];
      const combined = [...baseItems, ...stagedItems].map((it, i) => ({
        ...it,
        no: i + 1,
      }));
      setItems(combined);
      if (stagedItems.length > 0) clearDraft();

      setProjectName(existing.project_name || "");
      setClientName(existing.client_name || "");
      setClientEmail(existing.client_email || "");
      setClientPhone(existing.client_phone || "");
      setSalesEng(existing.sales_engineer || "ENG. Yahya Khaled");
      setSalesPhone(existing.config_json?.salesPhone || "+962 795172566");
      setPreparedBy(existing.prepared_by || user.username);
      setRefCode(existing.ref);
      setSiteName(existing.site_name || "");
      setTaxPercent(Number(existing.tax_percent ?? 16));
      setShowPictures(Boolean(existing.config_json?.showPictures));
      setTerms(
        Array.isArray(existing.config_json?.terms) &&
          existing.config_json!.terms!.length > 0
          ? existing.config_json!.terms!
          : [...DEFAULT_TERMS],
      );
      setExtraColumns(
        Array.isArray(existing.config_json?.extraColumns)
          ? existing.config_json!.extraColumns!
          : [],
      );
      setScopeIntro(existing.config_json?.scopeIntro || "");
      setDesignEngState(
        existing.config_json?.designEng || loadDesignEngineerPref() || "",
      );
      setPricingCategoryState(existing.config_json?.pricingCategory || "si");
      hydratedRef.current = true;
      return;
    }

    saveEditingContext(null);

    const d = loadDraft();
    setItems(d.items.map((it) => ({ ...it, price_si: it.price_si ?? it.unit_price })));
    setProjectName(d.projectName);
    setClientName(d.clientName);
    setClientEmail(d.clientEmail);
    setClientPhone(d.clientPhone);
    setSalesEng(d.salesEng);
    setSalesPhone(d.salesPhone);
    setPreparedBy(d.preparedBy || user.username);
    setRefCode(d.refCode);
    setSiteName(d.siteName);
    setTaxPercent(d.taxPercent);
    setShowPictures(d.showPictures);
    setTerms(d.terms.length > 0 ? d.terms : [...DEFAULT_TERMS]);
    setExtraColumns(d.extraColumns || []);
    setScopeIntro(d.scopeIntro || "");
    setDesignEngState(d.designEng || loadDesignEngineerPref() || "");
    setPricingCategoryState(d.pricingCategory || "si");
    hydratedRef.current = true;
  }, [existing, user.username]);

  // ── Persist draft whenever it changes (new-mode only) ─────────────────────
  useEffect(() => {
    if (!hydratedRef.current || editMode) return;
    saveDraft({
      items,
      projectName,
      clientName,
      clientEmail,
      clientPhone,
      salesEng,
      salesPhone,
      preparedBy,
      refCode,
      siteName,
      taxPercent,
      showPictures,
      terms,
      extraColumns,
      scopeIntro,
      designEng,
      pricingCategory,
    });
  }, [
    editMode,
    items,
    projectName,
    clientName,
    clientEmail,
    clientPhone,
    salesEng,
    salesPhone,
    preparedBy,
    refCode,
    siteName,
    taxPercent,
    showPictures,
    terms,
    extraColumns,
    scopeIntro,
    designEng,
    pricingCategory,
  ]);

  async function saveQuotation() {
    setSaving(true);
    setSaveStatus("");
    try {
      const totals = computeQuotationTotals(items, taxPercent);
      const payload = {
        ref: refCode || undefined,
        project_name: projectName || "Untitled Quotation",
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        sales_engineer: salesEng,
        prepared_by: preparedBy || user.username,
        site_name: siteName,
        tax_percent: taxPercent,
        items,
        totals,
        config: {
          showPictures,
          terms,
          salesPhone,
          extraColumns,
          scopeIntro,
          designEng,
          pricingCategory,
        },
      };
      const res = editMode
        ? await fetch(`/api/quotations?id=${existing!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/quotations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      if (editMode) {
        const now = new Date().toLocaleTimeString("en-GB");
        setSaveStatus(`Saved at ${now}`);
        return;
      }
      clearDraft();
      saveEditingContext(null);
      router.push(`/quotation?id=${data.quotation.id}`);
    } catch (err) {
      setSaveStatus(`Error: ${(err as Error).message}`);
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function clearAll() {
    if (!confirm("Clear the current quotation draft?")) return;
    setItems([]);
    setProjectName("");
    setClientName("");
    setClientEmail("");
    setClientPhone("");
    setSiteName("");
    setShowPictures(false);
    setTerms([...DEFAULT_TERMS]);
    setPricingCategoryState("si");
    if (!editMode) clearDraft();
  }

  return (
    <div className="space-y-4">
      {/* ── Settings toolbar ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-magic-border bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Pricing category */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
              Pricing category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PRICING_LABELS) as PricingCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setPricingCategory(cat)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    pricingCategory === cat
                      ? "bg-magic-red text-white"
                      : "border border-magic-border text-magic-ink/70 hover:bg-magic-soft"
                  }`}
                >
                  {PRICING_LABELS[cat]}
                  {cat !== "manual" && (
                    <span className="ml-1 text-[10px] opacity-70">
                      ×{PRICING_FACTORS[cat as Exclude<PricingCategory, "manual">]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {pricingCategory !== "manual" && (
              <p className="mt-1 text-[10px] text-magic-ink/50">
                All prices = SI base × {PRICING_FACTORS[pricingCategory as Exclude<PricingCategory, "manual">]}
              </p>
            )}
            {pricingCategory === "manual" && (
              <p className="mt-1 text-[10px] text-magic-ink/50">
                Edit each unit price individually in the table below.
              </p>
            )}
          </div>

          {/* Quick settings */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-magic-ink/60">
                Tax %
              </label>
              <input
                type="number"
                value={taxPercent}
                onChange={(e) => setTaxPercent(Number(e.target.value))}
                className="mt-1 w-20 rounded-md border border-magic-border px-2 py-1 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-magic-ink/80 pb-1">
              <input
                type="checkbox"
                checked={showPictures}
                onChange={(e) => setShowPictures(e.target.checked)}
              />
              Pictures
            </label>
          </div>
        </div>
      </div>

      {/* ── Quotation preview & table editor ─────────────────────────────── */}
      <div className="rounded-2xl border border-magic-border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Quotation preview</h3>
          <div className="flex items-center gap-2">
            {editMode && saveStatus && (
              <span
                className={`text-[11px] italic ${
                  saveStatus.startsWith("Error")
                    ? "text-red-600"
                    : "text-magic-ink/60"
                }`}
              >
                {saveStatus}
              </span>
            )}
            <button
              onClick={clearAll}
              disabled={items.length === 0 || saving}
              className="rounded-md border border-magic-border px-3 py-1.5 text-xs hover:bg-magic-soft disabled:opacity-40"
            >
              Clear
            </button>
            <button
              onClick={saveQuotation}
              disabled={items.length === 0 || saving}
              className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : editMode
                  ? "Save updates"
                  : "Save & open printable"}
            </button>
          </div>
        </div>
        <QuotationPreview
          header={{
            project_name: projectName,
            client_name: clientName,
            client_email: clientEmail,
            client_phone: clientPhone,
            sales_engineer: salesEng,
            sales_phone: salesPhone,
            prepared_by: preparedBy,
            design_engineer: designEng,
            site_name: siteName,
            ref: refCode || "PREVIEW",
            tax_percent: taxPercent,
            date: new Date().toLocaleDateString("en-GB"),
            extra_columns: extraColumns,
            scope_intro: scopeIntro,
          }}
          items={items}
          setItems={setItems}
          setHeader={(patch) => {
            if (patch.project_name !== undefined)
              setProjectName(patch.project_name);
            if (patch.client_name !== undefined)
              setClientName(patch.client_name);
            if (patch.client_email !== undefined)
              setClientEmail(patch.client_email);
            if (patch.client_phone !== undefined)
              setClientPhone(patch.client_phone);
            if (patch.sales_engineer !== undefined)
              setSalesEng(patch.sales_engineer);
            if (patch.sales_phone !== undefined)
              setSalesPhone(patch.sales_phone);
            if (patch.prepared_by !== undefined)
              setPreparedBy(patch.prepared_by);
            if (patch.ref !== undefined) setRefCode(patch.ref);
            if (patch.site_name !== undefined) setSiteName(patch.site_name);
            if (patch.extra_columns !== undefined)
              setExtraColumns(patch.extra_columns);
            if (patch.scope_intro !== undefined)
              setScopeIntro(patch.scope_intro);
            if (patch.design_engineer !== undefined)
              setDesignEng(patch.design_engineer);
          }}
          editable
          showPictures={showPictures}
          terms={terms}
          setTerms={setTerms}
        />
      </div>
    </div>
  );
}
