"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/crm/fetchJson";

interface Pipeline {
  id: number;
  name: string;
  is_default: boolean;
}
interface Stage {
  id: number;
  pipeline_id: number;
  name: string;
  position: number;
  win_prob: number;
  is_won: boolean;
  is_lost: boolean;
}
interface Deal {
  id: number;
  pipeline_id: number | null;
  stage_id: number | null;
  title: string;
  amount: number;
  currency: string;
  probability: number;
  status: string;
  expected_close_at: string | null;
  company_id: number | null;
  contact_id: number | null;
  // Cross-module join — populated by /api/crm/deals so the kanban card can
  // link directly to the source quotation + company without a second fetch.
  quotation_id?: number | null;
  quotation_ref?: string | null;
  company_name?: string | null;
}

export default function DealsKanban() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activePipeline, setActivePipeline] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title: "", amount: "0", stage_id: "" as string | number });
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  async function load() {
    setError(null);
    try {
      const pRes = await fetchJson<{ pipelines?: Pipeline[]; stages?: Stage[] }>(
        "/api/crm/pipelines",
      );
      const ps: Pipeline[] = pRes.pipelines ?? [];
      const sg: Stage[] = pRes.stages ?? [];
      setPipelines(ps);
      setStages(sg);
      const ap =
        activePipeline ?? ps.find((p) => p.is_default)?.id ?? ps[0]?.id ?? null;
      setActivePipeline(ap);
      if (ap != null) {
        const dRes = await fetchJson<{ deals?: Deal[] }>(
          `/api/crm/deals?pipeline_id=${ap}`,
        );
        setDeals(dRes.deals ?? []);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activePipeline == null) return;
    let cancelled = false;
    fetchJson<{ deals?: Deal[] }>(`/api/crm/deals?pipeline_id=${activePipeline}`)
      .then((d) => {
        if (!cancelled) setDeals(d.deals ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [activePipeline]);

  const stagesForActive = useMemo(
    () => stages.filter((s) => s.pipeline_id === activePipeline).sort((a, b) => a.position - b.position),
    [stages, activePipeline],
  );

  async function moveTo(stageId: number) {
    if (dragId == null) return;
    const id = dragId;
    setDragId(null);
    setDeals((cur) => cur.map((d) => (d.id === id ? { ...d, stage_id: stageId } : d)));
    const res = await fetch(`/api/crm/deals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage_id: stageId }),
    });
    if (!res.ok) load();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (activePipeline == null) return;
    setCreating(true);
    setError(null);
    try {
      const stageId = draft.stage_id ? Number(draft.stage_id) : stagesForActive[0]?.id;
      const res = await fetch(`/api/crm/deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          amount: Number(draft.amount) || 0,
          pipeline_id: activePipeline,
          stage_id: stageId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      setShowNew(false);
      setDraft({ title: "", amount: "0", stage_id: "" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const totalsByStage = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of deals) {
      if (d.stage_id == null) continue;
      m.set(d.stage_id, (m.get(d.stage_id) ?? 0) + Number(d.amount || 0));
    }
    return m;
  }, [deals]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-magic-ink">Deals</h1>
          {pipelines.length > 1 && (
            <select
              value={activePipeline ?? ""}
              onChange={(e) => setActivePipeline(Number(e.target.value))}
              className="rounded-md border border-magic-border px-2 py-1 text-sm"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={() => setShowNew((s) => !s)}
          className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700"
        >
          {showNew ? "Cancel" : "New deal"}
        </button>
      </div>

      {showNew && (
        <form
          onSubmit={create}
          className="mb-5 grid grid-cols-1 md:grid-cols-4 gap-3 rounded-2xl border border-magic-border bg-white p-4"
        >
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Title</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Amount</label>
            <input
              type="number"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-magic-ink/60 mb-1">Stage</label>
            <select
              value={draft.stage_id}
              onChange={(e) => setDraft({ ...draft, stage_id: e.target.value })}
              className="w-full rounded-md border border-magic-border px-3 py-2 text-sm"
            >
              <option value="">{stagesForActive[0]?.name ?? "—"}</option>
              {stagesForActive.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4 flex gap-2">
            <button
              type="submit"
              disabled={creating || !draft.title.trim()}
              className="rounded-md bg-magic-ink text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {creating ? "Creating…" : "Create deal"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {stagesForActive.map((stage) => {
            const stageDeals = deals.filter((d) => d.stage_id === stage.id);
            const total = totalsByStage.get(stage.id) ?? 0;
            return (
              <div
                key={stage.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => moveTo(stage.id)}
                className="w-72 shrink-0 rounded-2xl border border-magic-border bg-white/70 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-magic-ink">{stage.name}</h3>
                    <p className="text-[10px] text-magic-ink/50">
                      {stageDeals.length} deals · {total.toLocaleString()} {stageDeals[0]?.currency || "USD"}
                    </p>
                  </div>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                      (stage.is_won
                        ? "bg-emerald-100 text-emerald-700"
                        : stage.is_lost
                          ? "bg-red-100 text-red-700"
                          : "bg-magic-soft text-magic-ink/70")
                    }
                  >
                    {stage.win_prob}%
                  </span>
                </div>
                <div className="space-y-2 min-h-[60px]">
                  {stageDeals.map((d) => (
                    <div
                      key={d.id}
                      draggable
                      onDragStart={() => setDragId(d.id)}
                      className="cursor-grab active:cursor-grabbing rounded-xl border border-magic-border bg-white p-3 text-sm shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="font-medium text-magic-ink">{d.title}</div>
                      <div className="mt-1 text-xs text-magic-ink/60">
                        {Number(d.amount).toLocaleString()} {d.currency}
                      </div>
                      {(d.company_name || d.quotation_ref) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                          {d.company_name && d.company_id ? (
                            <Link
                              href={`/crm/companies/${d.company_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded-full bg-magic-soft px-2 py-0.5 font-semibold text-magic-ink/70 hover:text-magic-red"
                            >
                              {d.company_name}
                            </Link>
                          ) : null}
                          {d.quotation_ref && d.quotation_id ? (
                            <Link
                              href={`/quotation?id=${d.quotation_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded-full bg-magic-red/10 px-2 py-0.5 font-mono font-semibold text-magic-red hover:underline"
                            >
                              {d.quotation_ref}
                            </Link>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                  {stageDeals.length === 0 && (
                    <p className="text-[11px] text-magic-ink/40 italic">Drop deals here.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
