"use client";

import React from "react";

export interface QuotationItem {
  no: number;
  brand: string;
  model: string;
  description: string;
  quantity: number;
  unit_price: number;
  delivery: string;
  picture_hint?: string;
}

export interface QuotationHeader {
  ref: string;
  date?: string;
  project_name: string;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  sales_engineer?: string;
  prepared_by?: string;
  sales_phone?: string;
  site_name: string;
  tax_percent: number;
}

interface Props {
  header: QuotationHeader;
  items: QuotationItem[];
  setItems?: (items: QuotationItem[]) => void;
  editable?: boolean;
  logoUrl?: string;
}

function money(n: number): string {
  return `JOD ${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function PictureBadge({ hint }: { hint?: string }) {
  const label = (hint || "").toLowerCase();
  const emoji = label.includes("camera")
    ? "📷"
    : label.includes("sd") || label.includes("memory")
      ? "💾"
      : label.includes("switch")
        ? "🔀"
        : label.includes("nvr") || label.includes("dvr")
          ? "🗄️"
          : label.includes("speaker")
            ? "🔊"
            : label.includes("intercom")
              ? "📞"
              : label.includes("install")
                ? "🛠️"
                : "📦";
  return (
    <div className="flex items-center justify-center h-10 text-2xl">
      {emoji}
    </div>
  );
}

export default function QuotationPreview({
  header,
  items,
  setItems,
  editable = false,
  logoUrl,
}: Props) {
  const subtotal = items.reduce(
    (a, it) => a + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  );
  const tax = (subtotal * (header.tax_percent || 0)) / 100;
  const total = subtotal + tax;

  function update(i: number, patch: Partial<QuotationItem>) {
    if (!setItems) return;
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    setItems(next);
  }

  function addRow() {
    if (!setItems) return;
    setItems([
      ...items,
      {
        no: items.length + 1,
        brand: "",
        model: "",
        description: "",
        quantity: 1,
        unit_price: 0,
        delivery: "TBD",
      },
    ]);
  }

  function removeRow(i: number) {
    if (!setItems) return;
    setItems(items.filter((_, idx) => idx !== i).map((r, idx) => ({ ...r, no: idx + 1 })));
  }

  return (
    <div className="quotation-sheet text-[11px]">
      {/* Top brand strip */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="MagicTech" className="h-12" />
          ) : (
            <div>
              <div className="text-xs text-magic-ink/60">سحر التقنية</div>
              <div className="flex items-center gap-1">
                <span className="text-2xl font-black text-magic-red">Magic</span>
                <span className="text-2xl font-black text-magic-ink">Tech</span>
              </div>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-3xl font-black">
            <span className="text-magic-ink">Sales </span>
            <span className="text-magic-red">Quotation</span>
          </div>
        </div>
      </div>

      {/* Info header */}
      <div className="grid grid-cols-2 gap-4 mb-3 text-[10.5px]">
        <div>
          <div className="font-bold">
            {header.date || new Date().toLocaleDateString("en-GB")}
          </div>
          <div>
            <b>Project:</b> {header.project_name}
          </div>
          <div>
            <b>Client:</b> {header.client_name || "—"}
          </div>
          <div>
            <b>EMAIL:</b> {header.client_email || "—"}
          </div>
          <div>
            <b>Phone:</b> {header.client_phone || "—"}
          </div>
        </div>
        <div className="text-right">
          <div>
            <b>Ref:</b> {header.ref}
          </div>
          <div>
            <b>Prepared By:</b> {header.prepared_by || "—"}
          </div>
          <div>
            <b>Phone:</b> {header.sales_phone || "+962 795172566"}
          </div>
          <div>
            <b>Sales Engineer:</b> {header.sales_engineer || "—"}
          </div>
        </div>
      </div>

      <div className="site-banner">{header.site_name}</div>

      <table>
        <thead>
          <tr>
            <th style={{ width: "4%" }}>No</th>
            <th style={{ width: "10%" }}>Brand</th>
            <th style={{ width: "12%" }}>Model</th>
            <th style={{ width: "30%" }}>Description</th>
            <th style={{ width: "8%" }}>Picture</th>
            <th style={{ width: "6%" }}>Quantity</th>
            <th style={{ width: "8%" }}>Delivery</th>
            <th style={{ width: "10%" }}>Unit Price</th>
            <th style={{ width: "12%" }}>Total Price</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={9} className="py-4 text-magic-ink/50">
                No items yet. Ask the AI to design or add a row.
              </td>
            </tr>
          )}
          {items.map((it, i) => (
            <tr key={i}>
              <td>{it.no}</td>
              <td className="font-bold">
                {editable ? (
                  <input
                    className="w-full bg-transparent text-center"
                    value={it.brand}
                    onChange={(e) => update(i, { brand: e.target.value })}
                  />
                ) : (
                  it.brand
                )}
              </td>
              <td className="font-semibold">
                {editable ? (
                  <input
                    className="w-full bg-transparent text-center"
                    value={it.model}
                    onChange={(e) => update(i, { model: e.target.value })}
                  />
                ) : (
                  it.model
                )}
              </td>
              <td className="text-left align-top">
                {editable ? (
                  <textarea
                    rows={3}
                    className="w-full bg-transparent text-[10.5px]"
                    value={it.description}
                    onChange={(e) =>
                      update(i, { description: e.target.value })
                    }
                  />
                ) : (
                  <div className="whitespace-pre-wrap text-left">
                    {it.description}
                  </div>
                )}
              </td>
              <td>
                <PictureBadge hint={it.picture_hint} />
              </td>
              <td>
                {editable ? (
                  <input
                    type="number"
                    className="w-full bg-transparent text-center"
                    value={it.quantity}
                    onChange={(e) =>
                      update(i, { quantity: Number(e.target.value) })
                    }
                  />
                ) : (
                  it.quantity
                )}
              </td>
              <td>
                {editable ? (
                  <input
                    className="w-full bg-transparent text-center"
                    value={it.delivery}
                    onChange={(e) => update(i, { delivery: e.target.value })}
                  />
                ) : (
                  it.delivery
                )}
              </td>
              <td>
                {editable ? (
                  <input
                    type="number"
                    className="w-full bg-transparent text-center"
                    value={it.unit_price}
                    onChange={(e) =>
                      update(i, { unit_price: Number(e.target.value) })
                    }
                  />
                ) : (
                  money(it.unit_price)
                )}
              </td>
              <td className="font-semibold">
                {money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}
                {editable && (
                  <button
                    onClick={() => removeRow(i)}
                    className="no-print ml-2 text-red-500 text-[9px]"
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
          <tr className="totals-row grand">
            <td colSpan={8}>Grand Total Cost</td>
            <td>{money(subtotal)}</td>
          </tr>
          <tr className="totals-row">
            <td colSpan={8}>TAX ({header.tax_percent}%)</td>
            <td>{money(tax)}</td>
          </tr>
          <tr className="totals-row">
            <td colSpan={8}>Total Cost</td>
            <td>{money(total)}</td>
          </tr>
        </tbody>
      </table>

      {editable && (
        <button
          onClick={addRow}
          className="no-print mt-3 rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
        >
          + Add empty row
        </button>
      )}

      <div className="mt-4 text-[10.5px]">
        <div className="border-b border-magic-ink/40 inline-block font-bold italic mb-2">
          Terms and conditions
        </div>
        <ul className="mt-2 space-y-1">
          <li>• Validity: 1 week from the date of the offer.</li>
          <li>• Total cost include TAX and custom fees</li>
          <li>• Quotation price doesn&apos;t mean quantity reservation</li>
          <li>• Warranty: 1 year warranty for CCTV</li>
          <li>
            • Method of payments: 70% down payment & 30% upon items delivery
          </li>
          <li>• TBD = to be determined</li>
          <li>
            • Offer include all installation, and accessories for the first
            camera only
          </li>
        </ul>
        <p className="mt-3 font-bold italic">
          Presales Engineer: {header.sales_engineer || "—"}
        </p>
      </div>

      <div className="footer-address">
        Address: Amman – Gardens street – Khawaja Complex No.65 · Tel: +962
        65560272 · Fax: +962 65560275
      </div>
    </div>
  );
}
