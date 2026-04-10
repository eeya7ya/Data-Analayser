"use client";

import { useEffect, useMemo, useState } from "react";
import type { SystemEntry } from "@/lib/search";
import type { SessionUser } from "@/lib/auth";
import { GROQ_CHAT_MODELS, type GroqChatModelId } from "@/lib/groq";
import type { QuotationItem } from "./QuotationPreview";
import {
  appendItem,
  loadDraft,
  saveDraft,
} from "@/lib/quotationDraft";

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

export default function AIDesigner({
  systems: initialSystems,
  user,
}: {
  systems?: SystemEntry[];
  user: SessionUser;
}) {
  // Systems are fetched client-side on mount so server navigation to this
  // page is instant instead of blocking on a Postgres round-trip.
  const [systems, setSystems] = useState<SystemEntry[]>(initialSystems ?? []);
  useEffect(() => {
    if (initialSystems && initialSystems.length > 0) return;
    let cancelled = false;
    fetch("/api/catalogue/systems")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setSystems(d.systems || []);
      })
      .catch(() => {
        if (!cancelled) setSystems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialSystems]);
  const [systemId, setSystemId] = useState("");
  const [designModel, setDesignModel] = useState<GroqChatModelId>(
    GROQ_CHAT_MODELS[0].id,
  );
  const [brief, setBrief] = useState("");
  const [convHistory, setConvHistory] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [webLoading, setWebLoading] = useState(false);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [webResult, setWebResult] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  const systemsBy = useMemo(() => {
    const map = new Map<string, SystemEntry[]>();
    for (const s of systems) {
      if (!map.has(s.vendor)) map.set(s.vendor, []);
      map.get(s.vendor)!.push(s);
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
            .map(([k, v]) => `\u2022 ${k}: ${v}`)
            .join("\n")}\n\nPlease now generate the complete BoQ.`
        : brief;

      const res = await fetch("/api/groq/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemKey: systemId || undefined,
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

  /** Push AI-generated items into the shared localStorage draft so the
   *  Designer page (or an open editor tab) can pick them up. */
  function addItemsToDraft() {
    if (!result?.items?.length) return;
    const [selVendor, selSystem] = systemId ? systemId.split("||") : ["", ""];
    const sysLabel = systems.find(
      (s) => s.vendor === selVendor && s.system === (selSystem || ""),
    );
    const sysName = sysLabel
      ? `${sysLabel.vendor} ${sysLabel.system || ""}`.trim()
      : "AI Design";

    let count = 0;
    for (const it of result.items) {
      const desc =
        (it.description && it.description.trim()) ||
        (it.reason && it.reason.trim()) ||
        [it.brand, it.model].filter(Boolean).join(" ").trim() ||
        "AI-recommended item \u2014 please review and add details.";
      const price = Number(it.unit_price) || 0;
      appendItem({
        no: 0,
        system: sysName,
        brand: it.brand,
        model: it.model,
        description: desc,
        quantity: Number(it.quantity) || 1,
        unit_price: price,
        delivery: it.delivery || "TBD",
        picture_hint: it.picture_hint || "",
        price_si: price,
      });
      count++;
    }
    setAddedCount((c) => c + count);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left — AI controls */}
      <section className="space-y-4">
        <Card title="1 \u00b7 Select a system & AI model">
          <select
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
            className="w-full rounded-lg border border-magic-border bg-white px-3 py-2 text-sm"
          >
            <option value="">\u2014 Auto (cross-vendor) \u2014</option>
            {systemsBy.map(([vendor, list]) => (
              <optgroup key={vendor} label={vendor}>
                {list.map((s, i) => (
                  <option key={`${vendor}-${i}`} value={`${s.vendor}||${s.system}`}>
                    {s.system || s.vendor} ({s.product_count} products)
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

        <Card title="2 \u00b7 Describe the project (one sentence is enough)">
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
              disabled={loading || !brief.trim()}
              className="rounded-md bg-magic-red text-white py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
            >
              {loading ? "Designing\u2026" : "Design with Groq"}
            </button>
            <button
              onClick={runWebSearch}
              disabled={webLoading || !brief.trim()}
              className="rounded-md border border-magic-red text-magic-red py-2 text-sm font-semibold hover:bg-magic-red/5 disabled:opacity-60"
              title="Deep web search via Groq agentic model"
            >
              {webLoading ? "Searching web\u2026" : "Deep web search"}
            </button>
          </div>
        </Card>

        {result?.followup_questions?.length ? (
          <Card title="3 \u00b7 Answer the AI's questions">
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
                {loading ? "Re-designing\u2026" : "Submit answers & re-design"}
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
      </section>

      {/* Right — results & add-to-draft */}
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

        {result?.ready && result.items && result.items.length > 0 && (
          <Card title={`Generated items (${result.items.length})`}>
            <div className="overflow-auto max-h-96">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr className="bg-magic-soft text-left">
                    <th className="p-1.5 border border-magic-border">Brand</th>
                    <th className="p-1.5 border border-magic-border">Model</th>
                    <th className="p-1.5 border border-magic-border">Qty</th>
                    <th className="p-1.5 border border-magic-border">Price</th>
                    <th className="p-1.5 border border-magic-border">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((it, i) => (
                    <tr key={i} className="hover:bg-magic-soft/30">
                      <td className="p-1.5 border border-magic-border font-semibold">
                        {it.brand}
                      </td>
                      <td className="p-1.5 border border-magic-border">{it.model}</td>
                      <td className="p-1.5 border border-magic-border text-center">
                        {it.quantity}
                      </td>
                      <td className="p-1.5 border border-magic-border text-right">
                        {Number(it.unit_price).toFixed(2)}
                      </td>
                      <td className="p-1.5 border border-magic-border text-magic-ink/70">
                        {it.description || it.reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={addItemsToDraft}
              className="mt-3 w-full rounded-md bg-magic-red text-white py-2 text-sm font-semibold hover:bg-red-700"
            >
              Add {result.items.length} items to quotation draft
            </button>
            {addedCount > 0 && (
              <p className="mt-2 text-[11px] text-green-700 italic">
                {addedCount} item(s) added to draft. Open the{" "}
                <a href="/designer" className="underline text-magic-red">
                  Designer
                </a>{" "}
                to see them in the quotation.
              </p>
            )}
          </Card>
        )}

        {!result && !webResult && (
          <div className="rounded-2xl border border-dashed border-magic-border bg-magic-soft/20 p-8 text-center">
            <p className="text-sm text-magic-ink/50">
              Describe your project and click &ldquo;Design with Groq&rdquo; to
              generate a bill of quantities. The AI will recommend products from
              the catalog and you can add them to your quotation draft.
            </p>
          </div>
        )}
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
