"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SystemEntry } from "@/lib/manifest.generated";
import type { SessionUser } from "@/lib/auth";
import { GROQ_CHAT_MODELS, type GroqChatModelId } from "@/lib/groq";
import QuotationPreview, { QuotationItem } from "./QuotationPreview";

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

export default function Designer({
  systems,
  user,
}: {
  systems: SystemEntry[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [systemId, setSystemId] = useState<number | "">("");
  const [designModel, setDesignModel] = useState<GroqChatModelId>(
    GROQ_CHAT_MODELS[0].id,
  );
  const [brief, setBrief] = useState(
    "Kempinski Hotel Aqaba Red Sea — 10× indoor industry dashcam, SD cards, mobile surveillance base, full install.",
  );
  const [projectName, setProjectName] = useState("Kempinski Hotel Aqaba Red Sea");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [salesEng, setSalesEng] = useState("ENG. Yahya Khaled");
  const [siteName, setSiteName] = useState("AQABA SITE");
  const [taxPercent, setTaxPercent] = useState(16);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [webLoading, setWebLoading] = useState(false);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [webResult, setWebResult] = useState<string | null>(null);
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [saving, setSaving] = useState(false);

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
      const res = await fetch("/api/groq/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemId: systemId || undefined,
          userBrief: brief,
          answers,
          model: designModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "design failed");
      const r = data.result as DesignResult;
      setResult(r);
      if (r.ready && r.items) {
        setItems(
          r.items.map((it, i) => ({
            no: i + 1,
            brand: it.brand,
            model: it.model,
            description: it.description,
            quantity: Number(it.quantity) || 1,
            unit_price: Number(it.unit_price) || 0,
            delivery: it.delivery || "TBD",
            picture_hint: it.picture_hint || "",
          })),
        );
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
    try {
      const totals = computeTotals(items, taxPercent);
      const res = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_name: projectName,
          client_name: clientName,
          client_email: clientEmail,
          sales_engineer: salesEng,
          prepared_by: user.username,
          site_name: siteName,
          tax_percent: taxPercent,
          items,
          totals,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      router.push(`/quotation?id=${data.quotation.id}`);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* LEFT — controls */}
      <section className="lg:col-span-5 space-y-4">
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
            onChange={(e) => setBrief(e.target.value)}
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
            <Field label="Site" value={siteName} onChange={setSiteName} />
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
        </Card>
      </section>

      {/* RIGHT — quotation preview */}
      <section className="lg:col-span-7 space-y-4">
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
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Quotation preview</h3>
            <div className="flex gap-2">
              <button
                onClick={saveQuotation}
                disabled={items.length === 0 || saving}
                className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save & open printable"}
              </button>
            </div>
          </div>
          <QuotationPreview
            header={{
              project_name: projectName,
              client_name: clientName,
              client_email: clientEmail,
              sales_engineer: salesEng,
              prepared_by: user.username,
              site_name: siteName,
              ref: "PREVIEW",
              tax_percent: taxPercent,
              date: new Date().toLocaleDateString("en-GB"),
            }}
            items={items}
            setItems={setItems}
            editable
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

function computeTotals(items: QuotationItem[], taxPercent: number) {
  const subtotal = items.reduce(
    (acc, it) => acc + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  );
  const tax = (subtotal * taxPercent) / 100;
  return { subtotal, tax, total: subtotal + tax };
}
