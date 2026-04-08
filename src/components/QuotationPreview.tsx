"use client";

import React, { useRef } from "react";

export interface QuotationItem {
  no: number;
  /** System / vendor-category name used to group items onto separate pages. */
  system: string;
  brand: string;
  model: string;
  description: string;
  quantity: number;
  unit_price: number;
  delivery: string;
  picture_hint?: string;
  /** Manually-inserted image (data URL or external URL). */
  picture_url?: string;
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
  setHeader?: (patch: Partial<QuotationHeader>) => void;
  editable?: boolean;
  logoUrl?: string;
  showPictures?: boolean;
  terms?: string[];
  setTerms?: (terms: string[]) => void;
}

function money(n: number): string {
  return `JOD ${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function renumber(items: QuotationItem[]): QuotationItem[] {
  return items.map((it, i) => ({ ...it, no: i + 1 }));
}

/** Group items by their `system` field preserving first-seen order. */
function groupBySystem(items: QuotationItem[]): Array<{
  system: string;
  rows: Array<{ item: QuotationItem; globalIndex: number }>;
}> {
  const order: string[] = [];
  const map = new Map<
    string,
    Array<{ item: QuotationItem; globalIndex: number }>
  >();
  items.forEach((item, globalIndex) => {
    const key = item.system || item.brand || "General";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push({ item, globalIndex });
  });
  return order.map((system) => ({ system, rows: map.get(system)! }));
}

export default function QuotationPreview({
  header,
  items,
  setItems,
  setHeader,
  editable = false,
  logoUrl,
  showPictures = false,
  terms = [],
  setTerms,
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

  function addRowToSystem(system: string) {
    if (!setItems) return;
    setItems(
      renumber([
        ...items,
        {
          no: items.length + 1,
          system,
          brand: "",
          model: "",
          description: "",
          quantity: 1,
          unit_price: 0,
          delivery: "TBD",
        },
      ]),
    );
  }

  function removeRow(i: number) {
    if (!setItems) return;
    setItems(renumber(items.filter((_, idx) => idx !== i)));
  }

  function renameSystem(oldName: string, newName: string) {
    if (!setItems || !newName.trim() || newName === oldName) return;
    setItems(
      items.map((it) =>
        (it.system || it.brand || "General") === oldName
          ? { ...it, system: newName.trim() }
          : it,
      ),
    );
  }

  const groups = groupBySystem(items);
  // Number of printed pages = one per system group + one totals page.
  // When there are no items, just render a single empty page.
  const systemPages = groups.length > 0 ? groups : [];

  return (
    <div className="quotation-doc">
      {systemPages.length === 0 && (
        <QuotationPage
          header={header}
          setHeader={setHeader}
          editable={editable}
          logoUrl={logoUrl}
          isLast={!editable}
        >
          <p className="py-8 text-center text-magic-ink/50 text-xs">
            No items yet. Add products from the Catalog or use the AI Designer.
          </p>
        </QuotationPage>
      )}

      {systemPages.map((group, pageIdx) => (
        <QuotationPage
          key={group.system + pageIdx}
          header={header}
          setHeader={setHeader}
          editable={editable}
          logoUrl={logoUrl}
          pageLabel={`Page ${pageIdx + 1} of ${systemPages.length + 1}`}
          isLast={false}
        >
          <SystemBanner
            name={group.system}
            editable={editable}
            onRename={(v) => renameSystem(group.system, v)}
          />
          <SystemTable
            group={group}
            allPages={groups.map((g) => g.system)}
            showPictures={showPictures}
            editable={editable}
            onUpdate={update}
            onRemove={removeRow}
          />
          {editable && (
            <button
              onClick={() => addRowToSystem(group.system)}
              className="no-print mt-2 rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
            >
              + Add row to {group.system}
            </button>
          )}
        </QuotationPage>
      ))}

      {/* Final totals + terms page */}
      {systemPages.length > 0 && (
        <QuotationPage
          header={header}
          setHeader={setHeader}
          editable={editable}
          logoUrl={logoUrl}
          pageLabel={`Page ${systemPages.length + 1} of ${systemPages.length + 1}`}
          isLast
        >
          <div className="site-banner">Final Totals</div>
          <table>
            <tbody>
              <tr className="totals-row grand">
                <td style={{ width: "75%" }}>Grand Total Cost (Subtotal)</td>
                <td>{money(subtotal)}</td>
              </tr>
              <tr className="totals-row">
                <td>TAX ({header.tax_percent}%)</td>
                <td>{money(tax)}</td>
              </tr>
              <tr className="totals-row">
                <td>Total Cost</td>
                <td>{money(total)}</td>
              </tr>
            </tbody>
          </table>

          <TermsBlock
            terms={terms}
            setTerms={setTerms}
            editable={editable}
            salesEngineer={header.sales_engineer}
          />
        </QuotationPage>
      )}
    </div>
  );
}

// ─── Page wrapper ────────────────────────────────────────────────────────────

function QuotationPage({
  header,
  setHeader,
  editable = false,
  logoUrl,
  pageLabel,
  isLast,
  children,
}: {
  header: QuotationHeader;
  setHeader?: (patch: Partial<QuotationHeader>) => void;
  editable?: boolean;
  logoUrl?: string;
  pageLabel?: string;
  isLast?: boolean;
  children: React.ReactNode;
}) {
  // Default to /logo.png in /public. Drop the real PNG at
  // public/logo.png and it will appear automatically. If the file
  // is missing we fall back to the Magic Tech text block.
  const resolvedLogo = logoUrl || "/logo.png";
  const [logoBroken, setLogoBroken] = React.useState(false);
  return (
    <div
      className={`quotation-sheet text-[11px] ${isLast ? "" : "page-break-after"}`}
    >
      {/* Top brand strip */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {!logoBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolvedLogo}
              alt="Magic Tech"
              className="h-14 w-auto object-contain"
              onError={() => setLogoBroken(true)}
            />
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
          {pageLabel && (
            <div className="text-[9px] text-magic-ink/50 mt-1">{pageLabel}</div>
          )}
        </div>
      </div>

      {/* Info header — left column pinned to the left edge, right column pinned
       * to the right edge. Each column is a 2-col mini-grid so labels and
       * values line up cleanly instead of floating against the edge. */}
      <div className="flex justify-between items-start gap-4 mb-3 text-[10.5px]">
        <div className="inline-grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <div className="col-span-2 font-bold">
            <HeaderField
              value={header.date || new Date().toLocaleDateString("en-GB")}
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ date: v })}
              bold
            />
          </div>
          <div className="text-left font-bold">Project:</div>
          <div className="text-left">
            <HeaderField
              value={header.project_name}
              placeholder="—"
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ project_name: v })}
            />
          </div>
          <div className="text-left font-bold">Client:</div>
          <div className="text-left">
            <HeaderField
              value={header.client_name || ""}
              placeholder="—"
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ client_name: v })}
            />
          </div>
          <div className="text-left font-bold">EMAIL:</div>
          <div className="text-left">
            <HeaderField
              value={header.client_email || ""}
              placeholder="—"
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ client_email: v })}
            />
          </div>
          <div className="text-left font-bold">Phone:</div>
          <div className="text-left">
            <HeaderField
              value={header.client_phone || ""}
              placeholder="—"
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ client_phone: v })}
            />
          </div>
        </div>
        <div className="inline-grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <div className="text-left font-bold">Ref:</div>
          <div className="text-left">
            <HeaderField
              value={header.ref}
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ ref: v })}
            />
          </div>
          <div className="text-left font-bold">Prepared By:</div>
          <div className="text-left">
            <HeaderField
              value={header.prepared_by || ""}
              placeholder="—"
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ prepared_by: v })}
            />
          </div>
          <div className="text-left font-bold">Phone:</div>
          <div className="text-left">
            <HeaderField
              value={header.sales_phone || "+962 795172566"}
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ sales_phone: v })}
            />
          </div>
          <div className="text-left font-bold">Sales Engineer:</div>
          <div className="text-left">
            <HeaderField
              value={header.sales_engineer || ""}
              placeholder="—"
              editable={editable && !!setHeader}
              onChange={(v) => setHeader?.({ sales_engineer: v })}
            />
          </div>
        </div>
      </div>

      {children}

      {/* Footer: company address — pinned to the bottom of every sheet. */}
      <div className="footer-address">
        Address: Amman- Gardens street- Khawaja Complex No.65- Tel: +962 65560272
        Fax: +962 65560275
      </div>
    </div>
  );
}

// ─── Header field (inline editable) ──────────────────────────────────────────

function HeaderField({
  value,
  onChange,
  editable,
  placeholder,
  bold,
}: {
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  placeholder?: string;
  bold?: boolean;
}) {
  if (!editable) {
    return (
      <span className={bold ? "font-bold" : undefined}>
        {value || placeholder || ""}
      </span>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-transparent outline-none border-b border-dotted border-magic-border focus:border-magic-red ${
        bold ? "font-bold" : ""
      }`}
    />
  );
}

// ─── System banner (editable) ────────────────────────────────────────────────

function SystemBanner({
  name,
  editable,
  onRename,
}: {
  name: string;
  editable: boolean;
  onRename: (v: string) => void;
}) {
  const [draft, setDraft] = React.useState(name);
  React.useEffect(() => setDraft(name), [name]);
  if (!editable) return <div className="site-banner">{name}</div>;
  return (
    <div className="site-banner">
      <input
        className="bg-transparent text-center font-bold w-full outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
      />
    </div>
  );
}

// ─── Table for one system group ──────────────────────────────────────────────

function SystemTable({
  group,
  allPages,
  showPictures,
  editable,
  onUpdate,
  onRemove,
}: {
  group: { system: string; rows: Array<{ item: QuotationItem; globalIndex: number }> };
  allPages: string[];
  showPictures: boolean;
  editable: boolean;
  onUpdate: (globalIndex: number, patch: Partial<QuotationItem>) => void;
  onRemove: (globalIndex: number) => void;
}) {
  const colCount = showPictures ? 9 : 8;
  const subtotal = group.rows.reduce(
    (acc, { item }) =>
      acc + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
    0,
  );
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: "4%" }}>No</th>
          <th style={{ width: "10%" }}>Brand</th>
          <th style={{ width: "12%" }}>Model</th>
          <th style={{ width: showPictures ? "28%" : "36%" }}>Description</th>
          {showPictures && <th style={{ width: "10%" }}>Picture</th>}
          <th style={{ width: "6%" }}>Quantity</th>
          <th style={{ width: "8%" }}>Delivery</th>
          <th style={{ width: "10%" }}>Unit Price</th>
          <th style={{ width: "12%" }}>Total Price</th>
        </tr>
      </thead>
      <tbody>
        {group.rows.length === 0 && (
          <tr>
            <td colSpan={colCount} className="py-3 text-magic-ink/50">
              No items in this system.
            </td>
          </tr>
        )}
        {group.rows.map(({ item, globalIndex }) => (
          <tr key={globalIndex}>
            <td>{item.no}</td>
            <td className="font-bold">
              {editable ? (
                <input
                  className="w-full bg-transparent text-center"
                  value={item.brand}
                  onChange={(e) => onUpdate(globalIndex, { brand: e.target.value })}
                />
              ) : (
                item.brand
              )}
            </td>
            <td className="font-semibold">
              {editable ? (
                <input
                  className="w-full bg-transparent text-center"
                  value={item.model}
                  onChange={(e) => onUpdate(globalIndex, { model: e.target.value })}
                />
              ) : (
                item.model
              )}
            </td>
            <td className="text-left align-top">
              {editable ? (
                <textarea
                  rows={3}
                  className="w-full bg-transparent text-[10.5px]"
                  value={item.description}
                  onChange={(e) =>
                    onUpdate(globalIndex, { description: e.target.value })
                  }
                />
              ) : (
                <div className="whitespace-pre-wrap text-left">
                  {item.description}
                </div>
              )}
            </td>
            {showPictures && (
              <td>
                <PictureCell
                  item={item}
                  editable={editable}
                  onUpdate={(patch) => onUpdate(globalIndex, patch)}
                />
              </td>
            )}
            <td>
              {editable ? (
                <input
                  type="number"
                  className="w-full bg-transparent text-center"
                  value={item.quantity}
                  onChange={(e) =>
                    onUpdate(globalIndex, { quantity: Number(e.target.value) })
                  }
                />
              ) : (
                item.quantity
              )}
            </td>
            <td>
              {editable ? (
                <input
                  className="w-full bg-transparent text-center"
                  value={item.delivery}
                  onChange={(e) => onUpdate(globalIndex, { delivery: e.target.value })}
                />
              ) : (
                item.delivery
              )}
            </td>
            <td>
              {editable ? (
                <input
                  type="number"
                  className="w-full bg-transparent text-center"
                  value={item.unit_price}
                  onChange={(e) =>
                    onUpdate(globalIndex, { unit_price: Number(e.target.value) })
                  }
                />
              ) : (
                money(item.unit_price)
              )}
            </td>
            <td className="font-semibold">
              {money(
                (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
              )}
              {editable && (
                <div className="no-print mt-1 flex items-center justify-center gap-1">
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      if (v === "__new__") {
                        const name = prompt("Move to which page?", "");
                        if (name && name.trim())
                          onUpdate(globalIndex, { system: name.trim() });
                      } else {
                        onUpdate(globalIndex, { system: v });
                      }
                    }}
                    className="text-[9px] border border-magic-border rounded px-1 py-0.5 bg-white"
                    title="Move this row to another page"
                  >
                    <option value="">Move to…</option>
                    {allPages
                      .filter((p) => p !== group.system)
                      .map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    <option value="__new__">+ New page…</option>
                  </select>
                  <button
                    onClick={() => onRemove(globalIndex)}
                    className="text-red-500 text-[11px]"
                    title="Remove row"
                  >
                    ×
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
        <tr className="totals-row">
          <td colSpan={colCount - 1}>{group.system} Subtotal</td>
          <td>{money(subtotal)}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Picture cell with manual upload ─────────────────────────────────────────

function PictureCell({
  item,
  editable,
  onUpdate,
}: {
  item: QuotationItem;
  editable: boolean;
  onUpdate: (patch: Partial<QuotationItem>) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const src = item.picture_url || "";

  function onPick(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onUpdate({ picture_url: String(reader.result || "") });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={item.model}
          className="max-h-12 max-w-full object-contain"
        />
      ) : (
        <div className="text-[9px] text-magic-ink/40">no picture</div>
      )}
      {editable && (
        <div className="no-print flex items-center gap-1">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-[9px] text-magic-red underline"
          >
            {src ? "Replace" : "Upload"}
          </button>
          {src && (
            <button
              onClick={() => onUpdate({ picture_url: "" })}
              className="text-[9px] text-magic-ink/50"
            >
              clear
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </div>
      )}
    </div>
  );
}

// ─── Modular Terms & Conditions block ────────────────────────────────────────

function TermsBlock({
  terms,
  setTerms,
  editable,
  salesEngineer,
}: {
  terms: string[];
  setTerms?: (t: string[]) => void;
  editable: boolean;
  salesEngineer?: string;
}) {
  function update(i: number, v: string) {
    if (!setTerms) return;
    const next = terms.slice();
    next[i] = v;
    setTerms(next);
  }
  function remove(i: number) {
    if (!setTerms) return;
    setTerms(terms.filter((_, idx) => idx !== i));
  }
  function add() {
    if (!setTerms) return;
    setTerms([...terms, "New term"]);
  }

  return (
    <div className="mt-4 text-[10.5px]">
      <div className="border-b border-magic-ink/40 inline-block font-bold italic mb-2">
        Terms and conditions
      </div>
      <ul className="mt-2 space-y-1">
        {terms.map((t, i) => (
          <li key={i} className="flex items-start gap-1">
            <span>•</span>
            {editable ? (
              <>
                <input
                  value={t}
                  onChange={(e) => update(i, e.target.value)}
                  className="flex-1 bg-transparent border-b border-dotted border-magic-border outline-none"
                />
                <button
                  onClick={() => remove(i)}
                  className="no-print text-red-500 text-[9px]"
                  title="Remove term"
                >
                  ×
                </button>
              </>
            ) : (
              <span>{t}</span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <button
          onClick={add}
          className="no-print mt-2 rounded-md border border-magic-border px-2 py-0.5 text-[10px] hover:bg-magic-soft"
        >
          + Add term
        </button>
      )}
      <p className="mt-3 font-bold italic">
        Presales Engineer: {salesEngineer || "—"}
      </p>
    </div>
  );
}
