"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SystemEntry } from "@/lib/manifest.generated";
import type { SessionUser } from "@/lib/auth";
import { GROQ_CHAT_MODELS, type GroqChatModelId } from "@/lib/groq";
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
} from "@/lib/quotationDraft";
import { computeQuotationTotals } from "@/lib/quotationTotals";

interface DesignResult {
  ready: boolean;
  followup_questions?: Array<{ id: string; question: string; why: string }>;
  summary?: string;
  items?: Array<{
    brand: string;
    model: string;
    description: string;
    quantity: number;
    unit_price: number;
    delivery?: string;
    picture_hint?: string;
    reason?: string;
  }>;
  notes?: string;
  raw?: string;
  error?: string;
}

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
  };
}

export default function Designer({
  systems,
  user,
  existing,
}: {
  systems: SystemEntry[];
  user: SessionUser;
  existing?: ExistingQuotation;
}) {
  const router = useRouter();
  const editMode = !!existing;
  const [systemId, setSystemId] = useState<number | "">("");
  const [designModel, setDesignModel] = useState<GroqChatModelId>(
    GROQ_CHAT_MODELS[0].id,
  );
  const [brief, setBrief] = useState(
    "Kempinski Hotel Aqaba Red Sea — 10× indoor industry dashcam, SD cards, mobile surveillance base, full install.",
  );
  const [convHistory, setConvHistory] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [webLoading, setWebLoading] = useState(false);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [webResult, setWebResult] = useState<string | null>(null);
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [showPictures, setShowPictures] = useState(false);
  const [terms, setTerms] = useState<string[]>([...DEFAULT_TERMS]);
  const [extraColumns, setExtraColumns] = useState<QuotationExtraColumn[]>([]);
  const [scopeIntro, setScopeIntro] = useState("");
  const [designEng, setDesignEngState] = useState("");
  // Price-adjustment tool inputs — kept local, never persisted. Users apply
  // them with a button and the result is written straight to item.unit_price.
  const [priceMultiplier, setPriceMultiplier] = useState(1);
  const [embeddedTaxPct, setEmbeddedTaxPct] = useState(16);
  const [priceStatus, setPriceStatus] = useState("");
  // Becomes true after a successful Strip TAX press so subsequent presses
  // don't double-strip. Reset whenever the current item set is replaced
  // from an external source (hydrate, clear, AI result).
  const [taxStripped, setTaxStripped] = useState(false);
  const hydratedRef = useRef(false);

  // Wrap the design-engineer setter so it also updates the per-user
  // preference. The user types it once and it pre-fills on every future
  // quotation, even after a draft reset.
  function setDesignEng(value: string) {
    setDesignEngState(value);
    saveDesignEngineerPref(value);
  }

  // ── Hydrate state on mount ────────────────────────────────────────────────
  // Edit mode: load from the server-provided existing quotation, then fold in
  //   any items the user picked from the catalog since opening the editor.
  // New mode: load from localStorage draft.
  useEffect(() => {
    if (existing) {
      // Remember the editing context so /catalog can route "Open designer"
      // back to this same quotation (instead of silently starting a new one).
      saveEditingContext({
        id: existing.id,
        ref: existing.ref,
        projectName: existing.project_name || "",
      });

      const baseItems = (existing.items_json || []).map((it) => ({
        ...it,
        system: it.system || it.brand || "General",
      }));

      // If the user bounced to the catalog and added products, those landed
      // in the shared draft. Fold them into the edited quotation now and
      // clear the draft so refreshing the page doesn't duplicate them.
      const draft = loadDraft();
      const stagedItems =
        Array.isArray(draft.items) && draft.items.length > 0
          ? draft.items.map((it) => ({
              ...it,
              system: it.system || it.brand || "General",
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
      setTaxStripped(false);
      hydratedRef.current = true;
      return;
    }

    // New-mode: clear any stale editing context so /catalog behaves normally.
    saveEditingContext(null);

    const d = loadDraft();
    setItems(d.items);
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
    setTaxStripped(false);
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
  ]);

  const systemsBy = useMemo(() => {
    const map = new Map<string, SystemEntry[]>();
    for (const s of systems) {
      const g = s.vendor;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [systems]);

  async function runDesign() {
    setLoading(true);
    setResult(null);
    try {
      const hasAnswers =
        convHistory.length > 0 && Object.keys(answers).length > 0;
      const userBrief = hasAnswers
        ? `Here are my answers to your follow-up questions:\n${Object.entries(
            answers,
          )
            .map(([k, v]) => `• ${k}: ${v}`)
            .join("\n")}\n\nPlease now generate the complete BoQ.`
        : brief;

      const res = await fetch("/api/groq/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemId: systemId || undefined,
          userBrief,
          history: hasAnswers ? convHistory : [],
          answers,
          model: designModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "design failed");
      const r = data.result as DesignResult;
      setResult(r);

      if (!r.ready && r.followup_questions?.length) {
        setConvHistory([
          { role: "user", content: brief },
          { role: "assistant", content: JSON.stringify(r) },
        ]);
      } else {
        setConvHistory([]);
      }

      if (r.ready && r.items) {
        const sysLabel = systems.find((s) => s.id === systemId);
        const sysName = sysLabel
          ? `${sysLabel.vendor} ${sysLabel.category || ""}`.trim()
          : "AI Design";
        // Merge AI-generated items into existing list (append, not replace).
        const base = items.slice();
        r.items.forEach((it, i) => {
          // Never ship an AI-designed row with an empty description: fall
          // back to the AI's reason, then to brand/model, so every printed
          // quotation row carries something informative.
          const desc =
            (it.description && it.description.trim()) ||
            (it.reason && it.reason.trim()) ||
            [it.brand, it.model].filter(Boolean).join(" ").trim() ||
            "AI-recommended item — please review and add details.";
          base.push({
            no: base.length + i + 1,
            system: sysName,
            brand: it.brand,
            model: it.model,
            description: desc,
            quantity: Number(it.quantity) || 1,
            unit_price: Number(it.unit_price) || 0,
            delivery: it.delivery || "TBD",
            picture_hint: it.picture_hint || "",
          });
        });
        setItems(base.map((b, i) => ({ ...b, no: i + 1 })));
        setTaxStripped(false);
      }
    } catch (err) {
      setResult({ ready: false, error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  async function runWebSearch() {
    setWebLoading(true);
    setWebResult(null);
    try {
      const res = await fetch("/api/groq/web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: brief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "web search failed");
      setWebResult(JSON.stringify(data.result, null, 2));
    } catch (err) {
      setWebResult(`Error: ${(err as Error).message}`);
    } finally {
      setWebLoading(false);
    }
  }

  async function saveQuotation() {
    setSaving(true);
    setSaveStatus("");
    try {
      const totals = computeTotals(items, taxPercent);
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
        // Stay on the editor so the user can keep tweaking. A fresh
        // timestamp signals to them that the PATCH actually landed.
        const now = new Date().toLocaleTimeString("en-GB");
        setSaveStatus(`Saved at ${now}`);
        return;
      }
      clearDraft();
      // Once we navigate to the read-only view the editing session is over —
      // clear the context so re-visiting /catalog starts a fresh workflow.
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
    setTaxStripped(false);
    if (!editMode) clearDraft();
  }

  // ── Price-adjustment helpers ──────────────────────────────────────────────
  // "Apply" buttons mutate every unit_price on every row at once. We only
  // touch unit_price (not total_price) because total_price is always
  // recomputed from quantity × unit_price during render and save.
  function applyPriceMultiplier() {
    const factor = Number(priceMultiplier);
    if (!Number.isFinite(factor) || factor <= 0) {
      setPriceStatus("Enter a positive multiplier first.");
      return;
    }
    if (items.length === 0) {
      setPriceStatus("No items to adjust.");
      return;
    }
    if (
      !confirm(
        `Multiply every unit price by ${factor}? This cannot be undone automatically — you'll need to divide by the same factor to reverse it.`,
      )
    ) {
      return;
    }
    setItems(
      items.map((it) => ({
        ...it,
        unit_price: Number(((Number(it.unit_price) || 0) * factor).toFixed(2)),
      })),
    );
    setPriceStatus(`× ${factor} applied to ${items.length} item(s).`);
  }

  function stripEmbeddedTax() {
    if (taxStripped) {
      setPriceStatus(
        "TAX already stripped from the current items — add or reset items first.",
      );
      return;
    }
    const pct = Number(embeddedTaxPct);
    if (!Number.isFinite(pct) || pct <= 0) {
      setPriceStatus("Enter a positive TAX % first.");
      return;
    }
    if (items.length === 0) {
      setPriceStatus("No items to adjust.");
      return;
    }
    const divisor = 1 + pct / 100;
    if (
      !confirm(
        `Strip ${pct}% embedded TAX from every unit price (divide each by ${divisor})? TAX will then be added back via the header tax %.`,
      )
    ) {
      return;
    }
    setItems(
      items.map((it) => ({
        ...it,
        unit_price: Number(((Number(it.unit_price) || 0) / divisor).toFixed(2)),
      })),
    );
    setTaxStripped(true);
    setPriceStatus(`Embedded ${pct}% TAX stripped from ${items.length} item(s).`);
  }

  return (
    <div className="space-y-4">
      {/* TOP — controls toolbar (collapsible to give the preview room) */}
      <details className="no-print rounded-2xl border border-magic-border bg-white open:pb-3" open>
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between text-sm font-semibold">
          <span>Designer controls</span>
          <span className="text-[11px] text-magic-ink/50">
            Click to collapse / expand
          </span>
        </summary>
        <div className="px-4 pt-1 grid gap-3 lg:grid-cols-3 items-start">
        <Card title="1 · Select a system &amp; AI model">
          <select
            value={systemId}
            onChange={(e) =>
              setSystemId(e.target.value ? Number(e.target.value) : "")
            }
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
          >
            <option value="">— Auto (cross-vendor) —</option>
            {systemsBy.map(([vendor, list]) => (
              <optgroup key={vendor} label={vendor}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.category || s.vendor} ({s.productCount} products)
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="mt-3">
            <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
              Groq design model
            </label>
            <select
              value={designModel}
              onChange={(e) => setDesignModel(e.target.value as GroqChatModelId)}
              className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
            >
              {GROQ_CHAT_MODELS.map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-magic-ink/50">
              {GROQ_CHAT_MODELS.find((m) => m.id === designModel)?.description}
            </p>
          </div>
        </Card>

        <Card title="2 · Describe the project (one sentence is enough)">
          <textarea
            rows={4}
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value);
              setConvHistory([]);
              setAnswers({});
            }}
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
            placeholder="e.g. 20 IP bullet cameras 4MP ColorVu for a warehouse, with NVR and 4TB storage"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={runDesign}
              disabled={loading}
              className="rounded-md bg-magic-red text-white py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
            >
              {loading ? "Designing…" : "Design with Groq"}
            </button>
            <button
              onClick={runWebSearch}
              disabled={webLoading}
              className="rounded-md border border-magic-red text-magic-red py-2 text-sm font-semibold hover:bg-magic-red/5 disabled:opacity-60"
              title="Deep web search via Groq agentic model"
            >
              {webLoading ? "Searching web…" : "Deep web search"}
            </button>
          </div>
        </Card>

        {result?.followup_questions?.length ? (
          <Card title="3 · Answer the AI's questions">
            <div className="space-y-3">
              {result.followup_questions.map((q) => (
                <div key={q.id}>
                  <label className="text-xs font-semibold text-magic-ink/80">
                    {q.question}
                  </label>
                  <p className="text-[11px] text-magic-ink/50">{q.why}</p>
                  <input
                    value={answers[q.id] || ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [q.id]: e.target.value })
                    }
                    className="mt-1 w-full rounded-md border border-magic-border px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <button
                onClick={runDesign}
                disabled={loading}
                className="w-full rounded-md bg-magic-ink text-white py-2 text-sm font-semibold hover:bg-black disabled:opacity-60"
              >
                {loading ? "Re-designing…" : "Submit answers & re-design"}
              </button>
            </div>
          </Card>
        ) : null}

        {webResult && (
          <Card title="Deep web search result">
            <pre className="whitespace-pre-wrap text-[11px] font-mono bg-magic-soft/40 rounded p-3 max-h-64 overflow-auto">
              {webResult}
            </pre>
          </Card>
        )}

        <Card title="Quotation header">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Field label="Project" value={projectName} onChange={setProjectName} />
            <Field
              label="Site / Location"
              value={siteName}
              onChange={setSiteName}
            />
            <Field label="Client" value={clientName} onChange={setClientName} />
            <Field
              label="Client email"
              value={clientEmail}
              onChange={setClientEmail}
            />
            <Field
              label="Sales engineer"
              value={salesEng}
              onChange={setSalesEng}
            />
            <Field
              label="Presales engineer"
              value={designEng}
              onChange={setDesignEng}
            />
            <div>
              <label className="block text-[10px] font-semibold uppercase text-magic-ink/60">
                Tax %
              </label>
              <input
                type="number"
                value={taxPercent}
                onChange={(e) => setTaxPercent(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-magic-border px-2 py-1"
              />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-magic-ink/50">
            Presales engineer is remembered across quotations — set it once
            and it pre-fills every future draft.
          </p>
          <label className="mt-3 flex items-center gap-2 text-xs text-magic-ink/80">
            <input
              type="checkbox"
              checked={showPictures}
              onChange={(e) => setShowPictures(e.target.checked)}
            />
            Show picture column (pictures are uploaded manually per row)
          </label>
        </Card>

        <Card title="Price tools">
          <p className="text-[11px] text-magic-ink/60 mb-3">
            Bulk-adjust every unit price in the quotation. Helpful when the
            catalog ships DPP prices and you need to apply a margin, or when
            prices already include TAX and you want to add it separately via
            the header TAX %.
          </p>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-magic-ink/60">
                Multiply unit prices by
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={priceMultiplier}
                onChange={(e) =>
                  setPriceMultiplier(Number(e.target.value) || 0)
                }
                className="mt-1 w-full rounded-md border border-magic-border px-2 py-1 text-sm"
                placeholder="e.g. 1.15 for a 15% margin"
              />
            </div>
            <button
              onClick={applyPriceMultiplier}
              disabled={items.length === 0}
              className="h-[34px] rounded-md bg-magic-red text-white px-3 text-xs font-semibold hover:bg-red-700 disabled:opacity-40"
            >
              Apply ×
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end mt-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-magic-ink/60">
                Strip embedded TAX %
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                value={embeddedTaxPct}
                onChange={(e) =>
                  setEmbeddedTaxPct(Number(e.target.value) || 0)
                }
                className="mt-1 w-full rounded-md border border-magic-border px-2 py-1 text-sm"
                placeholder="e.g. 16"
              />
            </div>
            <button
              onClick={stripEmbeddedTax}
              disabled={items.length === 0 || taxStripped}
              className="h-[34px] rounded-md border border-magic-red text-magic-red px-3 text-xs font-semibold hover:bg-magic-red/5 disabled:opacity-40"
              title={
                taxStripped
                  ? "Already stripped from the current items"
                  : "Divide every unit price by (1 + TAX%)"
              }
            >
              {taxStripped ? "TAX stripped" : "Strip TAX"}
            </button>
          </div>
          {priceStatus && (
            <p className="mt-3 text-[11px] text-magic-ink/70 italic">
              {priceStatus}
            </p>
          )}
        </Card>
        </div>
      </details>

      {/* BELOW — quotation preview gets the full content width */}
      <section className="space-y-4">
        {result?.summary && (
          <Card title="Design summary">
            <p className="text-sm text-magic-ink/80 whitespace-pre-wrap">
              {result.summary}
            </p>
            {result.notes && (
              <p className="mt-2 text-xs text-magic-ink/60 whitespace-pre-wrap">
                {result.notes}
              </p>
            )}
          </Card>
        )}

        {result?.error && (
          <Card title="Error">
            <p className="text-sm text-red-600">{result.error}</p>
          </Card>
        )}

        <div className="rounded-2xl border border-magic-border bg-white p-4">
          <div className="no-print flex items-center justify-between mb-3">
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
                onClick={() => window.print()}
                disabled={items.length === 0}
                className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold hover:bg-magic-soft disabled:opacity-40"
                title="Print the current draft (uses browser print-to-PDF)"
              >
                Print
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
      </section>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-magic-border bg-white p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase text-magic-ink/60">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-magic-border px-2 py-1"
      />
    </div>
  );
}

// Delegates to the shared helper in @/lib/quotationTotals so the saved
// `totals` blob always matches what QuotationPreview renders, even when
// the user has merged unit-price cells.
function computeTotals(items: QuotationItem[], taxPercent: number) {
  return computeQuotationTotals(items, taxPercent);
}
