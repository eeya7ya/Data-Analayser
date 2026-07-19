"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  calculateRow,
  calculateTotals,
  type Constants,
  type ProductInput,
} from "@/lib/pricing/calculations";
import { cn } from "@/lib/pricing/utils";
import { Copy, ClipboardPaste, Lock, Unlock, Trash2, Settings2, RotateCcw, Info, X } from "@/lib/icons";

interface Row extends ProductInput {
  id: number;
  position: number;
}

interface Props {
  rows: Row[];
  constants: Constants;
  onChange: (rows: Row[]) => void;
  targetCurrency?: string;
}

function N(v: number) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

interface CalcColumn {
  label: string;
  unitKey: string;
  totalKey: string;
  color: string;
  highlight?: boolean;
}

function buildCalcColumns(currencyCode = "JOD"): CalcColumn[] {
  return [
  { label: `${currencyCode} Price`, unitKey: "jodPrice", totalKey: "jodPriceTotal", color: "text-amber-600" },
  { label: "Shipping", unitKey: "shipping", totalKey: "shippingTotal", color: "text-blue-600" },
  { label: "Customs", unitKey: "customs", totalKey: "customsTotal", color: "text-purple-600" },
  { label: "Landed Cost", unitKey: "landedCost", totalKey: "landedCostTotal", color: "text-orange-600", highlight: true },
  { label: "Profit", unitKey: "profit", totalKey: "profitTotal", color: "text-emerald-600" },
  { label: "Pre-Tax Price", unitKey: "preTaxPrice", totalKey: "preTaxPriceTotal", color: "text-teal-600" },
  { label: "Tax", unitKey: "tax", totalKey: "taxTotal", color: "text-rose-600" },
  { label: "Final Price", unitKey: "finalPrice", totalKey: "finalPriceTotal", color: "text-cyan-600", highlight: true },
  ];
}

type InputField = "itemModel" | "priceUsd" | "quantity";
type OverrideField = "shippingOverride" | "customsOverride";
type RateOverrideField =
  | "shippingRateOverride"
  | "customsRateOverride"
  | "profitRateOverride";

// Parse clipboard text into a 2D grid, honouring Excel/Sheets double-quote
// escaping. Crucially, a single cell that itself contains line breaks (or
// tabs) is wrapped in quotes on copy, so it stays in ONE cell instead of
// being split into extra rows — which is what lets a multi-line description
// paste as one row while a copied *column* of descriptions fills down.
function parseClipboardGrid(raw: string): string[][] {
  const text = raw.replace(/\r\n?/g, "\n");
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        // Doubled quote inside a quoted cell → a literal quote character.
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      grid.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  grid.push(row);
  // Drop the single trailing empty row spreadsheets append when copying.
  while (grid.length > 1) {
    const last = grid[grid.length - 1];
    if (last.length === 1 && last[0].trim() === "") grid.pop();
    else break;
  }
  return grid;
}

export function ProductTable({ rows, constants, onChange, targetCurrency }: Props) {
  const [copiedCol, setCopiedCol] = useState<InputField | "usdTotal" | null>(null);
  const [copiedCalcCol, setCopiedCalcCol] = useState<string | null>(null);
  const [openRatesRowId, setOpenRatesRowId] = useState<number | null>(null);
  // V1.8 — reveal the per-line internal description field (hidden by default;
  // never prints; carried into the quotation item description on convert).
  const [showDescriptions, setShowDescriptions] = useState(false);
  // When the clipboard can't be read on click, the paste button opens a
  // focused paste box for this column instead.
  const [pastePrompt, setPastePrompt] = useState<InputField | null>(null);
  const [notice, setNotice] = useState<{
    kind: "info" | "warn";
    title: string;
    details?: string[];
  } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = (n: {
    kind: "info" | "warn";
    title: string;
    details?: string[];
  }) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(n);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const CALC_COLUMNS = buildCalcColumns(targetCurrency);

  const calculated = rows.map((r) => ({
    ...r,
    ...calculateRow(r, constants),
  }));
  const totals = calculateTotals(calculated);

  const updateRow = (index: number, field: keyof Row, value: string | number | null) => {
    const updated = rows.map((r, i) =>
      i === index ? { ...r, [field]: value } : r
    );
    onChange(updated);
  };

  // Order of the editable input columns, used to map a pasted 2D block onto rows.
  const FIELD_ORDER: InputField[] = ["itemModel", "priceUsd", "quantity"];

  const parseCell = (field: InputField, val: string): string | number => {
    const t = val.trim();
    if (field === "priceUsd") {
      return parseFloat(t.replace(/[^0-9.]/g, "")) || 0;
    }
    if (field === "quantity") {
      return parseInt(t.replace(/[^0-9]/g, ""), 10) || 1;
    }
    return t; // itemModel
  };

  // Spreadsheet-style paste: dropping a clipboard block into a cell fills down
  // (one value per row) and across (tab-separated columns), anchored at the
  // pasted cell. Appends new rows when the block is taller than the table.
  const pasteIntoCell = (startIndex: number, anchorField: InputField, raw: string) => {
    const lines = raw.replace(/\r\n?/g, "\n").split("\n");
    // Drop a single trailing empty line (Excel/Sheets append one on copy).
    while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
    const grid = lines.map((line) => line.split("\t"));

    // Single scalar value → simple cell update, no row juggling.
    if (grid.length === 1 && grid[0].length === 1) {
      updateRow(startIndex, anchorField, parseCell(anchorField, grid[0][0]));
      return;
    }

    const anchorCol = FIELD_ORDER.indexOf(anchorField);
    const updated = [...rows];
    let idSeed = Date.now();

    grid.forEach((cells, r) => {
      const rowIndex = startIndex + r;
      if (rowIndex >= updated.length) {
        updated.push({
          id: idSeed++,
          position: updated.length + 1,
          itemModel: "",
          priceUsd: 0,
          quantity: 1,
        });
      }
      cells.forEach((cellVal, c) => {
        const field = FIELD_ORDER[anchorCol + c];
        if (!field) return; // beyond the known input columns
        updated[rowIndex] = {
          ...updated[rowIndex],
          [field]: parseCell(field, cellVal),
        };
      });
    });

    onChange(updated.map((r, i) => ({ ...r, position: i + 1 })));
  };

  // Fill-down paste for the internal description column. The model / price /
  // qty inputs already do this, but the description field is a multi-line
  // textarea, so a naive newline split would break a legitimately multi-line
  // description into extra rows. We instead parse the clipboard as quoted TSV:
  // a single (possibly multi-line) cell pastes normally into just this row,
  // while a copied *column* of descriptions fills down one per row —
  // appending rows when the block is taller than the table. Returns true when
  // it handled the paste, false to let the textarea paste normally.
  const pasteDescriptions = (startIndex: number, raw: string): boolean => {
    const grid = parseClipboardGrid(raw);
    if (grid.length <= 1) return false; // single cell → normal paste
    const updated = [...rows];
    let idSeed = Date.now();
    grid.forEach((cells, r) => {
      const rowIndex = startIndex + r;
      if (rowIndex >= updated.length) {
        updated.push({
          id: idSeed++,
          position: updated.length + 1,
          itemModel: "",
          priceUsd: 0,
          quantity: 1,
        });
      }
      updated[rowIndex] = {
        ...updated[rowIndex],
        description: (cells[0] ?? "").trim(),
      };
    });
    onChange(updated.map((r, i) => ({ ...r, position: i + 1 })));
    return true;
  };

  const toggleOverride = (index: number, field: OverrideField, currentCalculatedValue: number) => {
    const row = rows[index];
    const currentOverride = row[field];
    if (currentOverride != null) {
      // Lock: clear the override
      updateRow(index, field, null);
    } else {
      // Unlock: seed with current calculated value
      updateRow(index, field, parseFloat(currentCalculatedValue.toFixed(4)));
    }
  };

  const copyColumn = async (field: InputField) => {
    const filledRows = rows.filter((r) => r.itemModel !== "");
    const values = filledRows.map((r) => String(r[field])).join("\n");
    await navigator.clipboard.writeText(values);
    setCopiedCol(field);
    setTimeout(() => setCopiedCol(null), 1500);
  };

  const copyUsdTotalColumn = async () => {
    const filledRows = calculated.filter((r) => r.itemModel !== "");
    const values = filledRows.map((r) => N(r.usdTotal)).join("\n");
    await navigator.clipboard.writeText(values);
    setCopiedCol("usdTotal");
    setTimeout(() => setCopiedCol(null), 1500);
  };

  // Import a tab-separated block (Item Model / USD Price / Qty per line),
  // appending new rows and skipping models that already exist. Shared by
  // every column paste button so pasting a multi-column spreadsheet
  // selection always lands in the right columns.
  const pasteBlock = (lines: string[]) => {
    const updated = [...rows];
    const existingKeys = new Set(
      updated.map((r) => r.itemModel.trim().toLowerCase()).filter((k) => k !== "")
    );
    const seenInPaste = new Set<string>();
    const duplicates: string[] = [];
    const added: string[] = [];
    let idSeed = Date.now();

    lines.forEach((line) => {
      const cells = line.split("\t");
      const model = (cells[0] ?? "").trim();
      if (model === "") return;
      const price = parseFloat((cells[1] ?? "").replace(/[^0-9.]/g, "")) || 0;
      const qty = parseInt((cells[2] ?? "").replace(/[^0-9]/g, ""), 10) || 1;
      const key = model.toLowerCase();
      if (existingKeys.has(key) || seenInPaste.has(key)) {
        duplicates.push(model);
        return;
      }
      seenInPaste.add(key);
      const emptyIdx = updated.findIndex((r) => r.itemModel.trim() === "");
      if (emptyIdx !== -1) {
        updated[emptyIdx] = {
          ...updated[emptyIdx],
          itemModel: model,
          priceUsd: price,
          quantity: qty,
        };
      } else {
        updated.push({
          id: idSeed++,
          position: updated.length + 1,
          itemModel: model,
          priceUsd: price,
          quantity: qty,
        });
      }
      existingKeys.add(key);
      added.push(model);
    });

    onChange(updated.map((r, i) => ({ ...r, position: i + 1 })));

    if (duplicates.length > 0) {
      showNotice({
        kind: "warn",
        title:
          added.length > 0
            ? `Added ${added.length} item${added.length === 1 ? "" : "s"}, skipped ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}`
            : `Skipped ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"} — all pasted items already exist`,
        details: duplicates.map((d) => `Item model "${d}" has been repeated`),
      });
    } else if (added.length > 0) {
      showNotice({
        kind: "info",
        title: `Added ${added.length} new item${added.length === 1 ? "" : "s"}`,
      });
    }
  };

  const pasteColumn = async (field: InputField) => {
    // Prefer reading the clipboard directly (one click). Some browsers —
    // notably Firefox, and any non-HTTPS / permission-blocked context —
    // refuse navigator.clipboard.readText() even on a user gesture, so fall
    // back to a focused paste box the user can Ctrl/Cmd+V into. That keeps
    // the button working everywhere instead of silently failing.
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null;
    }
    if (text != null && text.trim() !== "") {
      applyPaste(field, text);
    } else {
      setPastePrompt(field);
    }
  };

  // Parse pasted clipboard text into the table for a given column. Shared by
  // the column paste button (direct read) and the paste-box fallback.
  const applyPaste = (field: InputField, text: string) => {
    // If the clipboard holds a tab-separated block (a multi-column
    // selection copied straight from Excel/Sheets), import the WHOLE block
    // — Item Model / USD Price / Qty — no matter which column button was
    // clicked. Otherwise a multi-column paste would dump tabs + numbers
    // into a single column (e.g. the item model becoming "MAG180\t341.35").
    const blockLines = text
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    if (blockLines.some((l) => l.includes("\t"))) {
      pasteBlock(blockLines);
      return;
    }

    const values = text
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter((v) => v !== "");

    if (values.length === 0) return;

    // ── Item Model paste: append new models, skip duplicates ──
    if (field === "itemModel") {
      const updated = [...rows];
      const existingKeys = new Set(
        updated
          .map((r) => r.itemModel.trim().toLowerCase())
          .filter((k) => k !== "")
      );
      const duplicates: string[] = [];
      const added: string[] = [];
      const seenInPaste = new Set<string>();
      let idSeed = Date.now();

      values.forEach((val) => {
        const key = val.toLowerCase();
        // Skip duplicates against existing rows or previously seen in paste
        if (existingKeys.has(key) || seenInPaste.has(key)) {
          duplicates.push(val);
          return;
        }
        seenInPaste.add(key);

        // Fill first empty row if any, otherwise append
        const emptyIdx = updated.findIndex((r) => r.itemModel.trim() === "");
        if (emptyIdx !== -1) {
          updated[emptyIdx] = { ...updated[emptyIdx], itemModel: val };
        } else {
          updated.push({
            id: idSeed++,
            position: updated.length + 1,
            itemModel: val,
            priceUsd: 0,
            quantity: 1,
          });
        }
        existingKeys.add(key);
        added.push(val);
      });

      // Re-number positions so they stay 1..N
      const renumbered = updated.map((r, i) => ({ ...r, position: i + 1 }));
      onChange(renumbered);

      if (duplicates.length > 0) {
        showNotice({
          kind: "warn",
          title:
            added.length > 0
              ? `Added ${added.length} item${added.length === 1 ? "" : "s"}, skipped ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"}`
              : `Skipped ${duplicates.length} duplicate${duplicates.length === 1 ? "" : "s"} — all pasted items already exist`,
          details: duplicates.map((d) => `Item model "${d}" has been repeated`),
        });
      } else if (added.length > 0) {
        showNotice({
          kind: "info",
          title: `Added ${added.length} new item${added.length === 1 ? "" : "s"}`,
        });
      }
      return;
    }

    // ── Price / Quantity paste: keep existing positional fill behaviour ──
    const updated = [...rows];
    values.forEach((val, i) => {
      let parsed: string | number = val;
      if (field === "priceUsd") {
        const clean = val.replace(/[^0-9.]/g, "");
        parsed = parseFloat(clean) || 0;
      }
      if (field === "quantity") {
        const clean = val.replace(/[^0-9]/g, "");
        parsed = parseInt(clean) || 1;
      }

      if (i < updated.length) {
        updated[i] = { ...updated[i], [field]: parsed };
      } else {
        updated.push({
          id: Date.now() + i,
          position: updated.length + 1,
          itemModel: "",
          priceUsd: field === "priceUsd" ? Number(parsed) : 0,
          quantity: field === "quantity" ? Number(parsed) : 1,
        });
      }
    });

    onChange(updated);
  };

  const copyCalcColumn = async (key: string) => {
    const filledRows = calculated.filter((r) => r.itemModel !== "");
    const values = filledRows.map((r) => N((r as any)[key])).join("\n");
    await navigator.clipboard.writeText(values);
    setCopiedCalcCol(key);
    setTimeout(() => setCopiedCalcCol(null), 1500);
  };

  const deleteRow = (index: number) => {
    const updated = rows
      .filter((_, i) => i !== index)
      .map((r, i) => ({ ...r, position: i + 1 }));
    onChange(updated);
  };

  const hasAnyRateOverride = (row: Row) =>
    row.shippingRateOverride != null ||
    row.customsRateOverride != null ||
    row.profitRateOverride != null;

  const ColActions = ({ field }: { field: InputField }) => (
    <span className="ml-1.5 inline-flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        title="Copy column"
        onClick={() => copyColumn(field)}
        className={cn(
          "rounded p-0.5 transition-colors",
          copiedCol === field
            ? "text-emerald-600"
            : "text-gray-400 hover:text-gray-600 hover:bg-gray-200"
        )}
      >
        <Copy size={11} />
      </button>
      <button
        title="Paste column"
        onClick={() => pasteColumn(field)}
        className="rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
      >
        <ClipboardPaste size={11} />
      </button>
    </span>
  );

  const pastePromptLabel =
    pastePrompt === "itemModel"
      ? "item models"
      : pastePrompt === "priceUsd"
        ? "USD prices"
        : "quantities";

  return (
    <div className="relative">
      {pastePrompt &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setPastePrompt(null);
            }}
          >
            <div className="w-96 max-w-full rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
              <p className="text-sm font-semibold text-gray-800">
                Paste {pastePromptLabel}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Press <kbd className="rounded border px-1">Ctrl</kbd>/
                <kbd className="rounded border px-1">⌘</kbd>+
                <kbd className="rounded border px-1">V</kbd> in the box below.
                One value per line — or paste a full Excel block (Item Model,
                Price, Qty) to fill every column at once.
              </p>
              <textarea
                autoFocus
                onPaste={(e) => {
                  e.preventDefault();
                  const t = e.clipboardData.getData("text");
                  const field = pastePrompt;
                  setPastePrompt(null);
                  if (field) applyPaste(field, t);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setPastePrompt(null);
                }}
                placeholder="Paste here…"
                className="mt-3 h-28 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => setPastePrompt(null)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {notice && (
        <div
          className={cn(
            "pointer-events-auto absolute right-3 top-3 z-40 w-80 rounded-lg border p-3 shadow-lg",
            notice.kind === "warn"
              ? "border-amber-200 bg-amber-50"
              : "border-cyan-200 bg-cyan-50"
          )}
          role="status"
        >
          <div className="flex items-start gap-2">
            <Info
              size={14}
              className={cn(
                "mt-0.5 flex-shrink-0",
                notice.kind === "warn" ? "text-amber-600" : "text-cyan-600"
              )}
            />
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-xs font-semibold",
                  notice.kind === "warn" ? "text-amber-800" : "text-cyan-800"
                )}
              >
                {notice.title}
              </p>
              {notice.details && notice.details.length > 0 && (
                <ul
                  className={cn(
                    "mt-1 list-disc pl-4 text-[11px] leading-tight max-h-32 overflow-y-auto",
                    notice.kind === "warn" ? "text-amber-700" : "text-cyan-700"
                  )}
                >
                  {notice.details.map((d, idx) => (
                    <li key={idx}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              onClick={() => {
                if (noticeTimer.current) clearTimeout(noticeTimer.current);
                setNotice(null);
              }}
              className={cn(
                "flex-shrink-0 rounded p-0.5 transition-colors",
                notice.kind === "warn"
                  ? "text-amber-500 hover:bg-amber-100 hover:text-amber-700"
                  : "text-cyan-500 hover:bg-cyan-100 hover:text-cyan-700"
              )}
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setShowDescriptions((v) => !v)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
            showDescriptions
              ? "border-sky-300 bg-sky-50 text-sky-700"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
          )}
          title="Show a per-line internal description. It never prints, but fills the item description when you convert this sheet to a quotation."
        >
          {showDescriptions ? "Hide descriptions" : "Show descriptions"}
        </button>
      </div>
      <div className="table-container max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-gray-200">
            {/* Fixed input columns */}
            <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-center font-semibold text-gray-500 whitespace-nowrap min-w-[40px]" rowSpan={2}>
              #
            </th>
            <th className="group sticky left-10 z-10 bg-gray-50 px-3 py-3 text-center font-semibold text-gray-500 whitespace-nowrap min-w-[140px]" rowSpan={2}>
              Item Model
              <ColActions field="itemModel" />
            </th>
            {showDescriptions && (
              <th
                className="px-3 py-3 text-center font-semibold text-sky-600 whitespace-nowrap min-w-[180px] border-l border-gray-100"
                rowSpan={2}
                title="Internal description — never prints; fills the item description on convert to quotation"
              >
                Description
              </th>
            )}
            <th className="px-3 py-3 text-center font-semibold text-gray-500 whitespace-nowrap min-w-[180px] border-l border-gray-100" colSpan={2}>
              USD Price
            </th>
            <th className="group px-3 py-3 text-center font-semibold text-gray-500 whitespace-nowrap min-w-[70px]" rowSpan={2}>
              Qty
              <ColActions field="quantity" />
            </th>
            <th className="w-16" rowSpan={2} />
            {/* Calculated columns (each has /Unit and Total) */}
            {CALC_COLUMNS.map((col) => (
              <th
                key={col.label}
                colSpan={2}
                className={cn(
                  "border-l border-gray-100 px-3 py-3 text-center font-semibold whitespace-nowrap",
                  col.highlight ? "bg-gray-100 text-gray-800" : "text-gray-500"
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
          {/* Sub-header for /Unit and Total */}
          <tr className="border-b border-gray-200 bg-gray-50">
            {/* USD Price /unit + total sub-headers */}
            <th className="group border-l border-gray-100 px-3 pb-2 text-center text-[10px] text-gray-400">
              <span className="inline-flex items-center justify-center gap-0.5">
                /unit
                <button
                  title="Copy USD /unit column"
                  onClick={() => copyColumn("priceUsd")}
                  className={cn(
                    "rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100",
                    copiedCol === "priceUsd"
                      ? "text-emerald-600"
                      : "text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                  )}
                >
                  <Copy size={10} />
                </button>
                <button
                  title="Paste USD /unit column"
                  onClick={() => pasteColumn("priceUsd")}
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <ClipboardPaste size={10} />
                </button>
              </span>
            </th>
            <th className="group px-3 pb-2 text-center text-[10px] text-gray-400">
              <span className="inline-flex items-center justify-center gap-0.5">
                total
                <button
                  title="Copy USD total column"
                  onClick={() => copyUsdTotalColumn()}
                  className={cn(
                    "rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100",
                    copiedCol === "usdTotal"
                      ? "text-emerald-600"
                      : "text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                  )}
                >
                  <Copy size={10} />
                </button>
              </span>
            </th>
            {CALC_COLUMNS.map((col) => (
              <>
                <th
                  key={`${col.label}-unit`}
                  className={cn(
                    "group border-l border-gray-100 px-3 pb-2 text-center text-[10px] text-gray-400",
                    col.highlight && "bg-gray-100"
                  )}
                >
                  <span className="inline-flex items-center justify-center gap-0.5">
                    /unit
                    <button
                      title={`Copy ${col.label} /unit column`}
                      onClick={() => copyCalcColumn(col.unitKey)}
                      className={cn(
                        "rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100",
                        copiedCalcCol === col.unitKey
                          ? "text-emerald-600"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                      )}
                    >
                      <Copy size={10} />
                    </button>
                  </span>
                </th>
                <th
                  key={`${col.label}-total`}
                  className={cn(
                    "group px-3 pb-2 text-center text-[10px] text-gray-400",
                    col.highlight && "bg-gray-100"
                  )}
                >
                  <span className="inline-flex items-center justify-center gap-0.5">
                    total
                    <button
                      title={`Copy ${col.label} total column`}
                      onClick={() => copyCalcColumn(col.totalKey)}
                      className={cn(
                        "rounded p-0.5 transition-colors opacity-0 group-hover:opacity-100",
                        copiedCalcCol === col.totalKey
                          ? "text-emerald-600"
                          : "text-gray-400 hover:text-gray-600 hover:bg-gray-200"
                      )}
                    >
                      <Copy size={10} />
                    </button>
                  </span>
                </th>
              </>
            ))}
          </tr>
        </thead>
        <tbody>
          {calculated.map((row, i) => (
            <tr
              key={row.id}
              className={cn(
                "group border-b border-gray-100 transition-colors",
                "hover:bg-gray-50",
                !row.itemModel && !row.priceUsd && "opacity-60"
              )}
            >
              {/* Row number */}
              <td className="sticky left-0 z-10 bg-white px-3 py-2.5 text-center font-medium text-gray-400">
                {row.position}
              </td>
              {/* Item Model */}
              <td className="sticky left-10 z-10 bg-white px-2 py-1.5">
                <input
                  type="text"
                  placeholder="Item model…"
                  value={row.itemModel}
                  onChange={(e) => updateRow(i, "itemModel", e.target.value)}
                  onPaste={(e) => {
                    const raw = e.clipboardData.getData("text");
                    // Only intercept multi-cell pastes; let plain text paste normally.
                    if (/[\n\r\t]/.test(raw.trim())) {
                      e.preventDefault();
                      pasteIntoCell(i, "itemModel", raw);
                    }
                  }}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-center text-gray-800 placeholder-gray-300 transition-colors focus:border-gray-300 focus:bg-gray-50 focus:outline-none"
                />
              </td>
              {/* Description — its own column, shown only when toggled on.
                  Never prints; carried into the quotation item on convert. */}
              {showDescriptions && (
                <td className="border-l border-gray-100 px-2 py-1.5 align-top">
                  <textarea
                    value={row.description ?? ""}
                    placeholder="Internal description…"
                    onChange={(e) => updateRow(i, "description", e.target.value)}
                    onPaste={(e) => {
                      // Paste a whole column of descriptions at once (fills
                      // down across rows), matching the model / price / qty
                      // columns. A single cell still pastes normally here.
                      if (pasteDescriptions(i, e.clipboardData.getData("text"))) {
                        e.preventDefault();
                      }
                    }}
                    rows={2}
                    className="no-print w-full min-w-[180px] resize-y rounded border border-dashed border-sky-300 bg-sky-50/40 px-1.5 py-1 text-left text-[11px] text-gray-700 placeholder-gray-400 focus:border-sky-400 focus:bg-white focus:outline-none"
                  />
                </td>
              )}
              {/* USD Price (input) */}
              <td className="border-l border-gray-100 px-2 py-1.5">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.priceUsd || ""}
                  placeholder="0.00"
                  onChange={(e) =>
                    updateRow(i, "priceUsd", parseFloat(e.target.value) || 0)
                  }
                  onPaste={(e) => {
                    e.preventDefault();
                    pasteIntoCell(i, "priceUsd", e.clipboardData.getData("text"));
                  }}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-center font-mono text-gray-800 placeholder-gray-300 transition-colors focus:border-gray-300 focus:bg-gray-50 focus:outline-none"
                />
              </td>
              {/* USD Total (computed) */}
              <td className="px-3 py-2.5 text-center font-mono whitespace-nowrap text-gray-500">
                {row.priceUsd ? N(row.usdTotal) : "—"}
              </td>
              {/* Quantity */}
              <td className="px-2 py-1.5">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={row.quantity}
                  onChange={(e) =>
                    updateRow(i, "quantity", parseInt(e.target.value) || 1)
                  }
                  onPaste={(e) => {
                    e.preventDefault();
                    pasteIntoCell(i, "quantity", e.clipboardData.getData("text"));
                  }}
                  className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-center font-mono text-gray-800 transition-colors focus:border-gray-300 focus:bg-gray-50 focus:outline-none"
                />
              </td>
              {/* Row actions: rate overrides + delete */}
              <td className="px-1 py-1.5">
                <div className="flex items-center gap-0.5">
                  <RowRateOverrides
                    row={rows[i]}
                    index={i}
                    constants={constants}
                    isOpen={openRatesRowId === row.id}
                    onOpen={() => setOpenRatesRowId(row.id)}
                    onClose={() => setOpenRatesRowId(null)}
                    onUpdate={(field, value) => updateRow(i, field, value)}
                    hasOverride={hasAnyRateOverride(rows[i])}
                  />
                  <button
                    title="Delete row"
                    onClick={() => deleteRow(i)}
                    className="rounded p-1 text-gray-300 opacity-0 transition-colors hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </td>
              {/* Calculated columns */}
              {CALC_COLUMNS.map((col) => {
                const isShipping = col.unitKey === "shipping";
                const isCustoms = col.unitKey === "customs";
                const isProfit = col.unitKey === "profit";
                const overrideField: OverrideField | null = isShipping
                  ? "shippingOverride"
                  : isCustoms
                  ? "customsOverride"
                  : null;
                const isValueOverridden = isShipping
                  ? row.shippingIsOverridden
                  : isCustoms
                  ? row.customsIsOverridden
                  : false;
                const isRateOverridden = isShipping
                  ? row.shippingRateIsOverridden
                  : isCustoms
                  ? row.customsRateIsOverridden
                  : isProfit
                  ? row.profitRateIsOverridden
                  : false;
                const overrideValue = overrideField ? (rows[i][overrideField] ?? null) : null;
                const calcValue = row.priceUsd ? (row as any)[col.unitKey] : null;

                return (
                  <>
                    <td
                      key={`${col.label}-unit`}
                      className={cn(
                        "border-l border-gray-100 px-2 py-1.5 text-center font-mono whitespace-nowrap",
                        col.color,
                        col.highlight && "bg-gray-50",
                        overrideField && "group/cell",
                        isRateOverridden && "bg-amber-50/50"
                      )}
                    >
                      {overrideField ? (
                        <div className="flex items-center justify-center gap-1">
                          {isValueOverridden ? (
                            <input
                              type="number"
                              min="0"
                              step="0.001"
                              value={overrideValue ?? ""}
                              onChange={(e) =>
                                updateRow(i, overrideField, parseFloat(e.target.value) || 0)
                              }
                              className={cn(
                                "w-24 rounded border bg-white px-1.5 py-0.5 text-center font-mono text-xs focus:outline-none",
                                isShipping
                                  ? "border-blue-300 text-blue-700 focus:border-blue-400"
                                  : "border-purple-300 text-purple-700 focus:border-purple-400"
                              )}
                            />
                          ) : (
                            <span className={row.priceUsd ? col.color : "text-gray-300"}>
                              {calcValue != null ? N(calcValue) : "—"}
                            </span>
                          )}
                          <button
                            title={isValueOverridden ? "Lock (use calculated value)" : "Unlock to override"}
                            onClick={() =>
                              toggleOverride(i, overrideField, calcValue ?? 0)
                            }
                            className={cn(
                              "rounded p-0.5 transition-colors flex-shrink-0",
                              isValueOverridden
                                ? isShipping
                                  ? "text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                  : "text-purple-500 hover:text-purple-700 hover:bg-purple-50"
                                : "text-gray-300 hover:text-gray-500 hover:bg-gray-100 opacity-0 group-hover/cell:opacity-100"
                            )}
                          >
                            {isValueOverridden ? <Unlock size={10} /> : <Lock size={10} />}
                          </button>
                        </div>
                      ) : (
                        <span>{row.priceUsd ? N((row as any)[col.unitKey]) : "—"}</span>
                      )}
                    </td>
                    <td
                      key={`${col.label}-total`}
                      className={cn(
                        "px-3 py-2.5 text-center font-mono whitespace-nowrap text-gray-500",
                        col.highlight && "bg-gray-50 !text-gray-800 font-medium",
                        isRateOverridden && "bg-amber-50/50"
                      )}
                    >
                      {row.priceUsd ? N((row as any)[col.totalKey]) : "—"}
                    </td>
                  </>
                );
              })}
            </tr>
          ))}
        </tbody>
        {/* Totals row */}
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50">
            <td className="sticky left-0 z-10 bg-gray-100 px-3 py-3 text-center" />
            <td className="sticky left-10 z-10 bg-gray-100 px-3 py-3 text-center text-sm font-bold text-gray-700">
              TOTALS
            </td>
            {showDescriptions && <td className="border-l border-gray-100 px-3 py-3" />}
            {/* USD /unit */}
            <td className="border-l border-gray-100 px-3 py-3" />
            {/* USD total */}
            <td className="px-3 py-3 text-center font-mono font-bold whitespace-nowrap text-gray-700">
              {N(totals.usdTotal)}
            </td>
            <td className="px-3 py-3" />
            <td className="px-3 py-3" />
            {CALC_COLUMNS.map((col) => (
              <>
                <td
                  key={`total-${col.label}-unit`}
                  className={cn(
                    "border-l border-gray-100 px-3 py-3",
                    col.highlight && "bg-gray-100"
                  )}
                />
                <td
                  key={`total-${col.label}-total`}
                  className={cn(
                    "px-3 py-3 text-center font-mono font-bold whitespace-nowrap",
                    col.highlight ? "bg-gray-100 text-cyan-600 text-sm" : "text-gray-700"
                  )}
                >
                  {N((totals as any)[col.totalKey])}
                </td>
              </>
            ))}
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  );
}

// ── Per-row rate override popover ──────────────────────────────────────────
interface RowRateOverridesProps {
  row: Row;
  index: number;
  constants: Constants;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onUpdate: (field: RateOverrideField, value: number | null) => void;
  hasOverride: boolean;
}

function RowRateOverrides({
  row,
  constants,
  isOpen,
  onOpen,
  onClose,
  onUpdate,
  hasOverride,
}: RowRateOverridesProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // The table now lives inside an `overflow-x-auto` scroll container, which
  // would clip an absolutely-positioned popover. Render it into a portal on
  // document.body with a fixed position computed from the button's rect so
  // it escapes the scroll container entirely.
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    const update = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuWidth = 288; // w-72
      const menuHeight = 240; // approximate; only used for off-screen clamps
      const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
      const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
      // Prefer opening to the right of the button; flip left if it would
      // run off-screen.
      let left = rect.right + 8;
      if (left + menuWidth > viewportW - 8) {
        left = Math.max(8, rect.left - menuWidth - 8);
      }
      let top = rect.top;
      if (top + menuHeight > viewportH - 8) {
        top = Math.max(8, viewportH - menuHeight - 8);
      }
      setPos({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      onClose();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen, onClose]);

  const fields: {
    key: RateOverrideField;
    label: string;
    color: string;
    ringColor: string;
    global: number;
  }[] = [
    {
      key: "shippingRateOverride",
      label: "Shipping",
      color: "text-blue-600",
      ringColor: "focus:border-blue-400",
      global: constants.shippingRate,
    },
    {
      key: "customsRateOverride",
      label: "Customs",
      color: "text-purple-600",
      ringColor: "focus:border-purple-400",
      global: constants.customsRate,
    },
    {
      key: "profitRateOverride",
      label: "Profit",
      color: "text-emerald-600",
      ringColor: "focus:border-emerald-400",
      global: constants.profitMargin,
    },
  ];

  const displayPct = (v: number | null | undefined, fallback: number) => {
    const used = v != null ? v : fallback;
    return (used * 100).toFixed(2);
  };

  const handleChange = (key: RateOverrideField, raw: string) => {
    if (raw.trim() === "") {
      onUpdate(key, null);
      return;
    }
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    onUpdate(key, parsed / 100);
  };

  const resetField = (key: RateOverrideField) => {
    onUpdate(key, null);
  };

  const resetAll = () => {
    onUpdate("shippingRateOverride", null);
    onUpdate("customsRateOverride", null);
    onUpdate("profitRateOverride", null);
  };

  const popover =
    isOpen && pos ? (
      <div
        ref={popoverRef}
        style={{ top: pos.top, left: pos.left, width: 288 }}
        className="fixed z-[1000] rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
      >
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-700">Per-row rates</p>
              <p className="text-[10px] text-gray-400">
                Override global % for this row only
              </p>
            </div>
            {hasOverride && (
              <button
                onClick={resetAll}
                title="Reset all to global"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            )}
          </div>

          <div className="space-y-2">
            {fields.map((f) => {
              const isOverridden = row[f.key] != null;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <label
                    className={cn(
                      "flex-1 text-xs font-medium",
                      isOverridden ? f.color : "text-gray-500"
                    )}
                  >
                    {f.label}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={displayPct(row[f.key], f.global)}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      className={cn(
                        "w-24 rounded-md border bg-white py-1 pl-2 pr-5 text-right font-mono text-xs",
                        "focus:outline-none",
                        isOverridden
                          ? cn("border-amber-300 text-amber-700", f.ringColor)
                          : "border-gray-200 text-gray-700 focus:border-gray-400"
                      )}
                      placeholder={(f.global * 100).toFixed(2)}
                    />
                    <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                      %
                    </span>
                  </div>
                  <button
                    onClick={() => resetField(f.key)}
                    disabled={!isOverridden}
                    title="Reset to global"
                    className={cn(
                      "rounded p-1 transition-colors",
                      isOverridden
                        ? "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        : "text-gray-200 cursor-not-allowed"
                    )}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-3 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
            Leave blank to use the global project rate.
          </p>
      </div>
    ) : null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        title={hasOverride ? "Custom rates set — click to edit" : "Set per-row rate overrides"}
        onClick={isOpen ? onClose : onOpen}
        className={cn(
          "rounded p-1 transition-colors",
          hasOverride
            ? "text-amber-600 hover:bg-amber-50"
            : "text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
        )}
      >
        <Settings2 size={12} />
      </button>
      {mounted && popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
