"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuotationItem } from "@/components/QuotationPreview";

/**
 * Installation Calculator. Prices a complete installation from the admin
 * rate book (conduit/cable per metre, labour per day, fixed location add,
 * accessories) and drops it onto the quotation as ONE row under the chosen
 * system:  MT · Installation and Configuration — <system> · Available · <selling>.
 *
 * Model (confirmed with the user):
 *   - hybrid: opens with sensible defaults pre-filled from the rate book,
 *     the user tweaks the project quantities,
 *   - location adds a fixed amount,
 *   - the row price is the selling price = cost × (1 + margin%).
 *
 * cost = points × (cable_m/pt × cable/m + conduit_m/pt × conduit/m)
 *        + Σ(accessory_cost × qty)
 *        + days × Σ(crew_count × day_rate)
 *        + location_fixed
 */

interface Rate {
  id: number;
  category: string;
  name: string;
  unit: string;
  unit_cost: number;
  active: boolean;
}

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const jod = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InstallationCalculatorModal({
  systems,
  onAdd,
  onClose,
}: {
  systems: string[];
  onAdd: (item: QuotationItem) => void;
  onClose: () => void;
}) {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [system, setSystem] = useState(systems[0] ?? "");
  const [points, setPoints] = useState("10");
  const [cableId, setCableId] = useState<string>("");
  const [cableMeters, setCableMeters] = useState("30");
  const [conduitId, setConduitId] = useState<string>("");
  const [conduitMeters, setConduitMeters] = useState("10");
  const [days, setDays] = useState("1");
  const [crew, setCrew] = useState<Record<number, string>>({});
  const [acc, setAcc] = useState<Record<number, string>>({});
  const [locationId, setLocationId] = useState<string>("");
  const [margin, setMargin] = useState("25");

  useEffect(() => {
    fetch("/api/admin/installation-rates", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { rates?: Rate[]; error?: string }) => {
        if (d.error) throw new Error(d.error);
        const active = (d.rates ?? []).filter((r) => r.active);
        setRates(active);
        // Preset defaults — the "hybrid" part. First cable/conduit/location,
        // and a default crew of 1 Engineer + 2 Technicians by name.
        const first = (c: string) => active.find((r) => r.category === c);
        if (first("cable")) setCableId(String(first("cable")!.id));
        if (first("conduit")) setConduitId(String(first("conduit")!.id));
        if (first("location")) setLocationId(String(first("location")!.id));
        const c: Record<number, string> = {};
        for (const r of active.filter((r) => r.category === "labor")) {
          c[r.id] = /tech/i.test(r.name) ? "2" : /eng/i.test(r.name) ? "1" : "0";
        }
        setCrew(c);
      })
      .catch((e) => setErr((e as Error).message));
  }, []);

  const byId = useMemo(() => {
    const m = new Map<number, Rate>();
    for (const r of rates ?? []) m.set(r.id, r);
    return m;
  }, [rates]);

  const cables = (rates ?? []).filter((r) => r.category === "cable");
  const conduits = (rates ?? []).filter((r) => r.category === "conduit");
  const labor = (rates ?? []).filter((r) => r.category === "labor");
  const accessories = (rates ?? []).filter((r) => r.category === "accessory");
  const locations = (rates ?? []).filter((r) => r.category === "location");

  const calc = useMemo(() => {
    const pts = num(points);
    const cable = byId.get(Number(cableId));
    const conduit = byId.get(Number(conduitId));
    const perPoint =
      (cable?.unit_cost ?? 0) * num(cableMeters) +
      (conduit?.unit_cost ?? 0) * num(conduitMeters);
    const materials = perPoint * pts;
    const accessoriesTotal = accessories.reduce(
      (a, r) => a + r.unit_cost * num(acc[r.id] ?? "0"),
      0,
    );
    const perDay = labor.reduce(
      (a, r) => a + r.unit_cost * num(crew[r.id] ?? "0"),
      0,
    );
    const laborTotal = perDay * num(days);
    const locationAdd = byId.get(Number(locationId))?.unit_cost ?? 0;
    const cost = materials + accessoriesTotal + laborTotal + locationAdd;
    const selling = cost * (1 + num(margin) / 100);
    return { materials, accessoriesTotal, laborTotal, locationAdd, cost, selling };
  }, [points, cableId, cableMeters, conduitId, conduitMeters, accessories, acc, labor, crew, days, locationId, margin, byId]);

  function submit() {
    const loc = byId.get(Number(locationId));
    const cable = byId.get(Number(cableId));
    const conduit = byId.get(Number(conduitId));
    const bits: string[] = [`${num(points)} point${num(points) === 1 ? "" : "s"}`];
    if (cable) bits.push(`${cable.name} ${num(cableMeters)}m/pt`);
    if (conduit) bits.push(conduit.name);
    const crewStr = labor
      .filter((r) => num(crew[r.id] ?? "0") > 0)
      .map((r) => `${num(crew[r.id])}×${r.name}`)
      .join(" + ");
    if (crewStr) bits.push(`${crewStr} · ${num(days)}d`);
    if (loc) bits.push(loc.name);

    const item: QuotationItem = {
      no: 0,
      system: system.trim() || "Installation",
      brand: "MT",
      model: "Installation and Configuration",
      description: bits.join(", "),
      quantity: 1,
      unit_price: Number(calc.selling.toFixed(2)),
      delivery: "Available",
    };
    onAdd(item);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-magic-ink/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-magic-ink">
            Installation Calculator
          </h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {err && (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {err}
          </p>
        )}
        {rates === null && !err ? (
          <p className="py-6 text-center text-sm text-magic-ink/50">Loading rate book…</p>
        ) : rates && rates.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The rate book is empty. An admin sets it up at Admin → Installation
            Calculator (conduit, cable, labour day-rates, locations).
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="System (row is filed under this)">
                <input
                  list="install-systems"
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  placeholder="e.g. CCTV"
                  className={inputCls}
                />
                <datalist id="install-systems">
                  {systems.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="Location">
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— none —</option>
                  {locations.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} (+{jod(r.unit_cost)})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Number of points">
                <input type="number" min="0" value={points} onChange={(e) => setPoints(e.target.value)} className={inputCls} />
              </Field>
              <div />

              <Field label="Cable">
                <select value={cableId} onChange={(e) => setCableId(e.target.value)} className={inputCls}>
                  <option value="">— none —</option>
                  {cables.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({jod(r.unit_cost)}/m)
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cable metres per point">
                <input type="number" min="0" value={cableMeters} onChange={(e) => setCableMeters(e.target.value)} className={inputCls} />
              </Field>

              <Field label="Conduit / pipe">
                <select value={conduitId} onChange={(e) => setConduitId(e.target.value)} className={inputCls}>
                  <option value="">— none —</option>
                  {conduits.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({jod(r.unit_cost)}/m)
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Conduit metres per point">
                <input type="number" min="0" value={conduitMeters} onChange={(e) => setConduitMeters(e.target.value)} className={inputCls} />
              </Field>
            </div>

            {/* Crew */}
            {labor.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-magic-ink/40">
                  Crew × {" "}
                  <input
                    type="number"
                    min="0"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className="w-16 rounded border border-magic-border px-1.5 py-0.5 text-sm"
                  />{" "}
                  day(s)
                </div>
                <div className="flex flex-wrap gap-3">
                  {labor.map((r) => (
                    <label key={r.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="number"
                        min="0"
                        value={crew[r.id] ?? "0"}
                        onChange={(e) => setCrew((p) => ({ ...p, [r.id]: e.target.value }))}
                        className="w-16 rounded border border-magic-border px-1.5 py-1"
                      />
                      <span className="text-magic-ink/70">
                        {r.name} ({jod(r.unit_cost)}/day)
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Accessories */}
            {accessories.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-magic-ink/40">
                  Accessories (total qty)
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {accessories.map((r) => (
                    <label key={r.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="number"
                        min="0"
                        value={acc[r.id] ?? "0"}
                        onChange={(e) => setAcc((p) => ({ ...p, [r.id]: e.target.value }))}
                        className="w-16 rounded border border-magic-border px-1.5 py-1"
                      />
                      <span className="truncate text-magic-ink/70">
                        {r.name} ({jod(r.unit_cost)})
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="mt-5 rounded-xl border border-magic-border bg-magic-soft/30 p-4 text-sm">
              <Line label="Materials (cable + conduit)" value={calc.materials} />
              {calc.accessoriesTotal > 0 && <Line label="Accessories" value={calc.accessoriesTotal} />}
              <Line label="Labour" value={calc.laborTotal} />
              {calc.locationAdd > 0 && <Line label="Location" value={calc.locationAdd} />}
              <Line label="Cost" value={calc.cost} bold />
              <div className="mt-1.5 flex items-center justify-between border-t border-magic-border/60 pt-1.5">
                <span className="flex items-center gap-1 text-magic-ink/70">
                  Margin
                  <input
                    type="number"
                    min="0"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                    className="w-16 rounded border border-magic-border px-1.5 py-0.5"
                  />
                  %
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-base font-bold text-magic-ink">
                <span>Selling price</span>
                <span>{jod(calc.selling)} JOD</span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md border border-magic-border px-3 py-1.5 text-sm font-semibold text-magic-ink/70 hover:bg-magic-soft">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={calc.selling <= 0 || !system.trim()}
                className="rounded-md bg-magic-red px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Add row to quotation
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-magic-border px-2 py-1.5 text-sm focus:border-magic-red focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-magic-ink/70">{label}</span>
      {children}
    </label>
  );
}

function Line({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold text-magic-ink" : "text-magic-ink/70"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{jod(value)}</span>
    </div>
  );
}
