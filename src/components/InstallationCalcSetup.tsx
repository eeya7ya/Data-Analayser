"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import Spinner from "@/components/Spinner";
import { installationSellPrice } from "@/lib/installationCalc";
import type { InstallationCalcItem } from "@/app/api/installation-calc/route";

/**
 * Admin → Installation Calculator setup. CRUD over the preset price book
 * (PVC conduits by size, cable runs, technician day rates, …) that the
 * Designer's Installation Calculator picker offers as selections.
 *
 * Admins maintain COST + MARGIN per line; the selling price column is
 * always derived (sell = cost × 100 / (100 − margin)) so the book can't
 * drift from the costing-sheet convention. Categories are free text —
 * a new category appears as soon as its first item is saved.
 */

const UNITS = ["m", "pcs", "point", "hour", "day", "lot"];

interface DraftItem {
  category: string;
  name: string;
  unit: string;
  unit_cost: string;
  margin_percent: string;
}

const EMPTY_DRAFT: DraftItem = {
  category: "",
  name: "",
  unit: "m",
  unit_cost: "",
  margin_percent: "25",
};

export default function InstallationCalcSetup({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<InstallationCalcItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftItem>(EMPTY_DRAFT);
  const [savingNew, setSavingNew] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/installation-calc?all=1", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        items?: InstallationCalcItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items ?? []);
    } catch (err) {
      setError((err as Error).message);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items ?? []) seen.add(it.category);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [items]);

  async function createItem() {
    if (savingNew) return;
    if (!draft.category.trim() || !draft.name.trim()) {
      setError("Category and item name are required.");
      return;
    }
    setSavingNew(true);
    setError(null);
    try {
      const res = await fetch("/api/installation-calc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: draft.category.trim(),
          name: draft.name.trim(),
          unit: draft.unit.trim() || "pcs",
          unit_cost: Number(draft.unit_cost) || 0,
          margin_percent: Number(draft.margin_percent) || 0,
        }),
      });
      const data = (await res.json()) as {
        item?: InstallationCalcItem;
        error?: string;
      };
      if (!res.ok || !data.item) {
        throw new Error(data.error || "Failed to add item.");
      }
      setItems((cur) => [...(cur ?? []), data.item!]);
      // Keep category + margin so several items of one family go in fast.
      setDraft((d) => ({ ...d, name: "", unit_cost: "" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingNew(false);
    }
  }

  if (items === null) {
    return (
      <div className="flex justify-center py-10">
        <Spinner size={22} label="Loading price book…" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {!readOnly && (
        <div className="rounded-2xl border border-magic-border bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-magic-ink">
            Add line item
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-magic-ink/60">
                Category
              </label>
              <input
                list="inst-calc-categories"
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
                placeholder="e.g. PVC Conduits"
                className="w-full rounded border border-magic-border px-2 py-1.5 text-sm"
              />
              <datalist id="inst-calc-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold text-magic-ink/60">
                Item name
              </label>
              <input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="e.g. PVC Conduit 20mm"
                className="w-full rounded border border-magic-border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-magic-ink/60">
                Unit
              </label>
              <select
                value={draft.unit}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, unit: e.target.value }))
                }
                className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-[11px] font-semibold text-magic-ink/60">
                  Cost JOD
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.unit_cost}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, unit_cost: e.target.value }))
                  }
                  className="w-full rounded border border-magic-border px-2 py-1.5 text-sm"
                />
              </div>
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-[11px] font-semibold text-magic-ink/60">
                  Margin %
                </label>
                <input
                  type="number"
                  min={0}
                  max={95}
                  value={draft.margin_percent}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, margin_percent: e.target.value }))
                  }
                  className="w-full rounded border border-magic-border px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-magic-ink/50">
              Selling price preview:{" "}
              <strong>
                JOD{" "}
                {installationSellPrice(
                  Number(draft.unit_cost) || 0,
                  Number(draft.margin_percent) || 0,
                ).toFixed(2)}
              </strong>{" "}
              / {draft.unit || "pcs"} — sell = cost × 100 / (100 − margin)
            </span>
            <button
              onClick={() => void createItem()}
              disabled={savingNew}
              className="inline-flex items-center gap-1.5 rounded-md bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {savingNew ? <Spinner size={12} /> : <Plus className="h-3.5 w-3.5" />}
              Add item
            </button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-magic-border bg-white px-6 py-10 text-center text-sm text-magic-ink/60">
          No line items yet. Add conduits, cables, technician fees and any
          other installation presets above — they become selections in the
          Designer&apos;s Installation Calculator.
        </div>
      ) : (
        categories.map((cat) => (
          <CategoryTable
            key={cat}
            category={cat}
            items={items.filter((i) => i.category === cat)}
            readOnly={readOnly}
            onChanged={(next) =>
              setItems((cur) =>
                (cur ?? []).map((i) => (i.id === next.id ? next : i)),
              )
            }
            onDeleted={(id) =>
              setItems((cur) => (cur ?? []).filter((i) => i.id !== id))
            }
            onError={setError}
          />
        ))
      )}
    </div>
  );
}

function CategoryTable({
  category,
  items,
  readOnly,
  onChanged,
  onDeleted,
  onError,
}: {
  category: string;
  items: InstallationCalcItem[];
  readOnly: boolean;
  onChanged: (item: InstallationCalcItem) => void;
  onDeleted: (id: number) => void;
  onError: (msg: string | null) => void;
}) {
  return (
    <div className="rounded-2xl border border-magic-border bg-white">
      <h3 className="border-b border-magic-border/60 px-4 py-2.5 text-sm font-bold text-magic-ink">
        {category}
        <span className="ml-2 text-[11px] font-normal text-magic-ink/40">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-magic-ink/50">
              <th className="px-4 py-2 font-semibold">Item</th>
              <th className="px-2 py-2 font-semibold">Unit</th>
              <th className="px-2 py-2 font-semibold">Cost JOD</th>
              <th className="px-2 py-2 font-semibold">Margin %</th>
              <th className="px-2 py-2 font-semibold">Sell JOD</th>
              <th className="px-2 py-2 font-semibold">Active</th>
              {!readOnly && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-magic-border/40">
            {items.map((it) => (
              <ItemEditRow
                key={it.id}
                item={it}
                readOnly={readOnly}
                onChanged={onChanged}
                onDeleted={onDeleted}
                onError={onError}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemEditRow({
  item,
  readOnly,
  onChanged,
  onDeleted,
  onError,
}: {
  item: InstallationCalcItem;
  readOnly: boolean;
  onChanged: (item: InstallationCalcItem) => void;
  onDeleted: (id: number) => void;
  onError: (msg: string | null) => void;
}) {
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState(item.unit);
  const [cost, setCost] = useState(String(item.unit_cost));
  const [margin, setMargin] = useState(String(item.margin_percent));
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== item.name ||
    unit !== item.unit ||
    Number(cost) !== item.unit_cost ||
    Number(margin) !== item.margin_percent;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch("/api/installation-calc", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, ...body }),
      });
      const data = (await res.json()) as {
        item?: InstallationCalcItem;
        error?: string;
      };
      if (!res.ok || !data.item) {
        throw new Error(data.error || "Failed to save.");
      }
      onChanged(data.item);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${item.name}" from the price book?`)) return;
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/installation-calc?id=${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to delete.");
      }
      onDeleted(item.id);
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  }

  const sell = installationSellPrice(Number(cost) || 0, Number(margin) || 0);
  const cellInput =
    "w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-magic-border focus:border-magic-red focus:bg-white focus:outline-none disabled:opacity-60";

  return (
    <tr className={item.active ? "" : "opacity-50"}>
      <td className="px-3 py-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly || busy}
          className={cellInput}
        />
      </td>
      <td className="w-20 px-1 py-1.5">
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          disabled={readOnly || busy}
          className={cellInput}
        >
          {UNITS.includes(unit) ? null : <option value={unit}>{unit}</option>}
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </td>
      <td className="w-24 px-1 py-1.5">
        <input
          type="number"
          min={0}
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          disabled={readOnly || busy}
          className={cellInput}
        />
      </td>
      <td className="w-20 px-1 py-1.5">
        <input
          type="number"
          min={0}
          max={95}
          value={margin}
          onChange={(e) => setMargin(e.target.value)}
          disabled={readOnly || busy}
          className={cellInput}
        />
      </td>
      <td className="w-24 px-2 py-1.5 font-semibold text-magic-ink/80">
        {sell.toFixed(2)}
      </td>
      <td className="w-16 px-2 py-1.5">
        <input
          type="checkbox"
          checked={item.active}
          disabled={readOnly || busy}
          onChange={(e) => void patch({ active: e.target.checked })}
          className="h-4 w-4 accent-magic-red"
        />
      </td>
      {!readOnly && (
        <td className="w-24 px-2 py-1.5">
          <div className="flex items-center justify-end gap-1.5">
            {dirty && (
              <button
                onClick={() =>
                  void patch({
                    name: name.trim() || item.name,
                    unit: unit.trim() || item.unit,
                    unit_cost: Number(cost) || 0,
                    margin_percent: Number(margin) || 0,
                  })
                }
                disabled={busy}
                title="Save changes"
                className="inline-flex items-center gap-1 rounded-md bg-magic-red px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? <Spinner size={10} /> : <Save className="h-3 w-3" />}
                Save
              </button>
            )}
            <button
              onClick={() => void remove()}
              disabled={busy}
              title="Delete this item"
              className="rounded-md border border-magic-border p-1 text-magic-ink/50 hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}
