"use client";

import { useEffect, useMemo, useState } from "react";
import Spinner from "@/components/Spinner";
import type { QuotationItem } from "./QuotationPreview";
import { installationSellPrice } from "@/lib/installationCalc";
import type { InstallationCalcItem } from "@/app/api/installation-calc/route";

/**
 * Installation Calculator picker — opened from the Designer toolbar.
 *
 * Lists the admin-maintained preset price book (/admin/installation-
 * calculator) grouped by category; the user types quantities against the
 * presets they need (metres of conduit, cable runs, technician days, …)
 * and the tool prices the whole installation (1st + 2nd + 3rd FIX) with
 * the costing-sheet rule (sell = cost × 100 / (100 − margin)). "Add to
 * quotation" drops ONE summary row under the chosen system; the line
 * breakdown goes into that row's description and stays editable there.
 */
export default function InstallationCalculatorModal({
  existingPages,
  onAdd,
  onClose,
}: {
  existingPages: string[];
  onAdd: (item: QuotationItem) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<InstallationCalcItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [system, setSystem] = useState(existingPages[0] ?? "");
  const [customSystem, setCustomSystem] = useState("");
  // Description auto-builds from the picked lines until the user edits it
  // by hand — after that their text wins.
  const [descTouched, setDescTouched] = useState(false);
  const [descOverride, setDescOverride] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/installation-calc", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as {
          items?: InstallationCalcItem[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items ?? []) seen.add(it.category);
    return [...seen];
  }, [items]);

  const picked = useMemo(
    () =>
      (items ?? [])
        .map((it) => ({ item: it, n: Number(qty[it.id]) || 0 }))
        .filter((p) => p.n > 0),
    [items, qty],
  );

  const total = useMemo(
    () =>
      Math.round(
        picked.reduce(
          (sum, p) =>
            sum +
            p.n * installationSellPrice(p.item.unit_cost, p.item.margin_percent),
          0,
        ) * 100,
      ) / 100,
    [picked],
  );

  const autoDescription = useMemo(() => {
    if (picked.length === 0) return "";
    const lines = picked.map(
      (p) => `${p.n} ${p.item.unit} ${p.item.name}`,
    );
    return (
      "Supply & installation works (1st + 2nd + 3rd FIX) including: " +
      lines.join("; ") +
      "."
    );
  }, [picked]);
  const description = descTouched ? descOverride : autoDescription;

  const targetSystem =
    (system === "__custom" ? customSystem : system).trim() || "Installation";

  function addToQuotation() {
    if (picked.length === 0 || total <= 0) return;
    onAdd({
      no: 0,
      system: targetSystem,
      brand: "Magic Tech",
      model: "Installation",
      description: description || "Supply & installation works.",
      quantity: 1,
      unit_price: total,
      delivery: "Available",
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-magic-border/60 px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-magic-ink">
              Installation Calculator
            </h3>
            <p className="text-[11px] text-magic-ink/50">
              Pick quantities from the preset price book — admins maintain it
              under Admin → Installation Calculator.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {items === null ? (
            <div className="flex justify-center py-10">
              <Spinner size={20} label="Loading price book…" />
            </div>
          ) : error ? (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-magic-border bg-magic-soft/30 p-4 text-xs text-magic-ink/70">
              The price book is empty. Ask an admin to add conduits, cables
              and technician fees under{" "}
              <span className="font-semibold">
                Admin → Installation Calculator
              </span>
              .
            </div>
          ) : (
            categories.map((cat) => (
              <div key={cat} className="mb-4">
                <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-magic-red">
                  {cat}
                </h4>
                <ul className="divide-y divide-magic-border/40 rounded-lg border border-magic-border/60">
                  {(items ?? [])
                    .filter((it) => it.category === cat)
                    .map((it) => {
                      const sell = installationSellPrice(
                        it.unit_cost,
                        it.margin_percent,
                      );
                      const n = Number(qty[it.id]) || 0;
                      return (
                        <li
                          key={it.id}
                          className="flex items-center gap-2 px-3 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-magic-ink">
                              {it.name}
                            </div>
                            <div className="text-[11px] text-magic-ink/50">
                              JOD {sell.toFixed(2)} / {it.unit}
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={qty[it.id] ?? ""}
                            onChange={(e) =>
                              setQty((cur) => ({
                                ...cur,
                                [it.id]: e.target.value,
                              }))
                            }
                            placeholder="0"
                            className="w-20 rounded border border-magic-border px-2 py-1 text-right text-sm"
                            aria-label={`Quantity of ${it.name} (${it.unit})`}
                          />
                          <span className="w-9 shrink-0 text-[11px] text-magic-ink/50">
                            {it.unit}
                          </span>
                          <span className="w-20 shrink-0 text-right text-xs font-semibold text-magic-ink/80">
                            {n > 0
                              ? (Math.round(n * sell * 100) / 100).toFixed(2)
                              : "—"}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 border-t border-magic-border/60 px-5 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-[11px] font-semibold text-magic-ink/60 sm:w-28">
              Add under system
            </label>
            {existingPages.length > 0 ? (
              <select
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                className="w-full max-w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm sm:flex-1"
              >
                {existingPages.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="__custom">Other (type a name)…</option>
              </select>
            ) : null}
            {(existingPages.length === 0 || system === "__custom") && (
              <input
                value={customSystem}
                onChange={(e) => setCustomSystem(e.target.value)}
                placeholder="Installation"
                className="w-full rounded border border-magic-border px-2 py-1.5 text-sm sm:flex-1"
              />
            )}
          </div>
          {picked.length > 0 && (
            <textarea
              value={description}
              onChange={(e) => {
                setDescTouched(true);
                setDescOverride(e.target.value);
              }}
              rows={2}
              className="w-full rounded border border-magic-border px-2 py-1.5 text-xs text-magic-ink/80"
              aria-label="Row description"
            />
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-magic-ink">
              Total: <span className="text-magic-red">JOD {total.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
              >
                Cancel
              </button>
              <button
                onClick={addToQuotation}
                disabled={picked.length === 0 || total <= 0}
                className="rounded-md bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Add to quotation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
