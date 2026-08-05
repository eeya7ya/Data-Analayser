"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "@/lib/icons";
import Select from "@/components/Select";

/**
 * Admin editor for the installation-calculator rate book. One flat list of
 * priced inputs, grouped by category, that the Designer's calculator combines:
 *
 *   - conduit / cable   → per metre
 *   - labor             → engineer / technician per day
 *   - location          → region uplift (% or fixed)
 *   - accessory         → faceplates, jacks, boxes, digging… per piece/metre
 *
 * Inline edit (saves on change/blur), add per category, delete. Admin only —
 * the API enforces it; this is the UX surface.
 */

interface Rate {
  id: number;
  category: string;
  name: string;
  unit: string;
  unit_cost: number;
  sort: number;
  active: boolean;
}

const UNITS = ["meter", "day", "piece", "percent", "fixed"] as const;

const CATEGORIES: Array<{
  key: string;
  label: string;
  hint: string;
  defaultUnit: string;
}> = [
  { key: "conduit", label: "Conduit / Pipe", hint: "PVC, EMT, trunking — usually per metre.", defaultUnit: "meter" },
  { key: "cable", label: "Cable", hint: "Cat6, Cat6A, fiber — per metre (per drum ÷ length).", defaultUnit: "meter" },
  { key: "labor", label: "Labour (per day)", hint: "Engineer / technician day rate.", defaultUnit: "day" },
  { key: "location", label: "Location / Region", hint: "Uplift for Middle / North / South — % markup or a fixed add.", defaultUnit: "percent" },
  { key: "accessory", label: "Accessories & misc", hint: "Faceplates, jacks, junction boxes, digging, pull boxes…", defaultUnit: "piece" },
];

export default function InstallationRatesAdmin() {
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/installation-rates", { cache: "no-store" });
      const data = (await res.json()) as { rates?: Rate[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRates(data.rates ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: number, fields: Partial<Rate>) {
    setRates((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
    try {
      const res = await fetch("/api/admin/installation-rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...fields }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError((err as Error).message);
      void load();
    }
  }

  async function add(category: string, defaultUnit: string) {
    try {
      const res = await fetch("/api/admin/installation-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, name: "New item", unit: defaultUnit, unit_cost: 0 }),
      });
      const data = (await res.json()) as { rate?: Rate; error?: string };
      if (!res.ok || !data.rate) throw new Error(data.error || `HTTP ${res.status}`);
      setRates((prev) => [...prev, data.rate as Rate]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: number) {
    setRates((prev) => prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/admin/installation-rates?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setError((err as Error).message);
      void load();
    }
  }

  if (loading && rates.length === 0) {
    return <p className="text-sm text-magic-ink/50">Loading rate book…</p>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      {CATEGORIES.map((cat) => {
        const rows = rates
          .filter((r) => r.category === cat.key)
          .sort((a, b) => a.sort - b.sort || a.id - b.id);
        return (
          <div key={cat.key} className="rounded-2xl border border-magic-border bg-white p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-magic-ink">{cat.label}</h3>
              <button
                onClick={() => add(cat.key, cat.defaultUnit)}
                className="inline-flex items-center gap-1 rounded-lg border border-magic-border px-2.5 py-1 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            <p className="mb-3 text-xs text-magic-ink/50">{cat.hint}</p>

            {rows.length === 0 ? (
              <p className="py-2 text-sm italic text-magic-ink/40">No items yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-magic-ink/40">
                      <th className="pb-1 font-semibold">Name</th>
                      <th className="pb-1 font-semibold">Unit</th>
                      <th className="pb-1 text-right font-semibold">Cost (JOD)</th>
                      <th className="pb-1 text-center font-semibold">On</th>
                      <th className="pb-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-magic-border/50">
                        <td className="py-1.5 pr-2">
                          <input
                            defaultValue={r.name}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== r.name) patch(r.id, { name: v });
                            }}
                            className="w-full min-w-[140px] rounded border border-transparent px-1.5 py-1 hover:border-magic-border focus:border-magic-red focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Select
                            value={r.unit}
                            onChange={(next) => patch(r.id, { unit: next })}
                            className="rounded border border-magic-border px-1.5 py-1 text-xs"
                          >
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            defaultValue={r.unit_cost}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v >= 0 && v !== r.unit_cost) {
                                patch(r.id, { unit_cost: v });
                              }
                            }}
                            className="w-24 rounded border border-transparent px-1.5 py-1 text-right hover:border-magic-border focus:border-magic-red focus:outline-none"
                          />
                        </td>
                        <td className="py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={r.active}
                            onChange={(e) => patch(r.id, { active: e.target.checked })}
                            className="h-4 w-4 rounded border-magic-border text-magic-red focus:ring-magic-red"
                          />
                        </td>
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() => remove(r.id)}
                            aria-label="Delete"
                            className="rounded p-1 text-magic-ink/30 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
