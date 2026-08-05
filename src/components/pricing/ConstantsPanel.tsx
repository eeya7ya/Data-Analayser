"use client";

import { useState } from "react";
import { type Constants } from "@/lib/pricing/calculations";
import { cn } from "@/lib/pricing/utils";
import { RefreshCw } from "@/lib/icons";
import Spinner from "@/components/Spinner";
import Select from "@/components/Select";

export interface Currency {
  code: string;
  name: string;
  flag: string;
  defaultRate: number;
}

export const CURRENCIES: Currency[] = [
  { code: "USD", name: "US Dollar",           flag: "🇺🇸", defaultRate: 1.0    },
  { code: "JOD", name: "Jordanian Dinar",    flag: "🇯🇴", defaultRate: 0.71   },
  { code: "SAR", name: "Saudi Riyal",         flag: "🇸🇦", defaultRate: 3.75   },
  { code: "AED", name: "UAE Dirham",          flag: "🇦🇪", defaultRate: 3.67   },
  { code: "KWD", name: "Kuwaiti Dinar",       flag: "🇰🇼", defaultRate: 0.307  },
  { code: "BHD", name: "Bahraini Dinar",      flag: "🇧🇭", defaultRate: 0.377  },
  { code: "QAR", name: "Qatari Riyal",        flag: "🇶🇦", defaultRate: 3.64   },
  { code: "EGP", name: "Egyptian Pound",      flag: "🇪🆬", defaultRate: 48.8   },
  { code: "EUR", name: "Euro",                flag: "🇪🇺", defaultRate: 0.92   },
  { code: "GBP", name: "British Pound",       flag: "🇬🇧", defaultRate: 0.79   },
  { code: "TRY", name: "Turkish Lira",        flag: "🇹🇷", defaultRate: 34.0   },
  { code: "CNY", name: "Chinese Yuan",        flag: "🇨🇳", defaultRate: 7.26   },
  { code: "JPY", name: "Japanese Yen",        flag: "🇯🇵", defaultRate: 149.0  },
  { code: "INR", name: "Indian Rupee",        flag: "🇮🇳", defaultRate: 83.5   },
  { code: "CAD", name: "Canadian Dollar",     flag: "🇨🇦", defaultRate: 1.36   },
  { code: "AUD", name: "Australian Dollar",   flag: "🇦🇺", defaultRate: 1.52   },
];

interface ConstantField {
  key: keyof Constants;
  label: string;
  description: string;
  isRate: boolean;
  color: string;
}

function buildConstantFields(sourceCurrency: string, targetCurrency: string): ConstantField[] {
  return [
    {
      key: "currencyRate",
      label: "Currency Rate",
      description: `from ${sourceCurrency} to ${targetCurrency}`,
      isRate: false,
      color: "text-amber-600",
    },
    {
      key: "shippingRate",
      label: "Shipping Cost",
      description: "% of local price",
      isRate: true,
      color: "text-blue-600",
    },
    {
      key: "customsRate",
      label: "Customs",
      description: "% of (local price + shipping)",
      isRate: true,
      color: "text-purple-600",
    },
    {
      key: "profitMargin",
      label: "Profit Margin",
      description: "% on landed cost",
      isRate: true,
      color: "text-emerald-600",
    },
    {
      key: "taxRate",
      label: "Tax Rate",
      description: "% on pre-tax price",
      isRate: true,
      color: "text-rose-600",
    },
  ];
}

interface Props {
  constants: Constants;
  onChange: (updated: Constants) => void;
  saving?: boolean;
  sourceCurrency: string;
  targetCurrency: string;
  onSourceCurrencyChange: (code: string) => void;
  onCurrencyChange: (code: string, newRate: number) => void;
}

export function ConstantsPanel({
  constants,
  onChange,
  saving,
  sourceCurrency,
  targetCurrency,
  onSourceCurrencyChange,
  onCurrencyChange,
}: Props) {
  const [fetchingRate, setFetchingRate] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  // Raw text held while a field is being edited, so typing doesn't get
  // reformatted (e.g. "72." snapping back to "72.0000") on every keystroke.
  const [editing, setEditing] = useState<Partial<Record<keyof Constants, string>>>(
    {},
  );

  const CONSTANT_FIELDS = buildConstantFields(sourceCurrency, targetCurrency);

  const displayValue = (field: ConstantField) => {
    const v = constants[field.key];
    // Never surface a literal "NaN" in the box — show it blank so the user
    // can just type a value instead of staring at NaN.
    if (!Number.isFinite(v)) return "";
    return field.isRate ? (v * 100).toFixed(2) : v.toFixed(4);
  };

  // What the input shows: the user's in-progress text while focused,
  // otherwise the tidy formatted value.
  const fieldText = (field: ConstantField) =>
    editing[field.key] !== undefined ? editing[field.key]! : displayValue(field);

  // On focus, seed the editable text with a compact, trailing-zero-free
  // version of the current value so it's quick to retype.
  const beginEdit = (field: ConstantField) => {
    const v = constants[field.key];
    const raw = field.isRate ? v * 100 : v;
    const text =
      Number.isFinite(raw) ? String(parseFloat((raw as number).toFixed(6))) : "";
    setEditing((e) => ({ ...e, [field.key]: text }));
  };

  // While typing: keep the raw text verbatim and, when it parses to a
  // number, push the value up live so the table/charts update as you type.
  const editChange = (field: ConstantField, raw: string) => {
    // Allow only digits and a single decimal point (plus empty) so the
    // field stays numeric but every in-progress value ("", "72", "72.")
    // is accepted.
    if (!/^\d*\.?\d*$/.test(raw)) return;
    setEditing((e) => ({ ...e, [field.key]: raw }));
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      const value = field.isRate ? parsed / 100 : parsed;
      onChange({ ...constants, [field.key]: value });
    }
  };

  // On blur, drop the editing text so the field falls back to the tidy
  // formatted display (and a blank field reverts to its last good value).
  const endEdit = (field: ConstantField) => {
    setEditing((e) => {
      const next = { ...e };
      delete next[field.key];
      return next;
    });
  };

  const handleCurrencySelect = (code: string) => {
    const currency = CURRENCIES.find((c) => c.code === code);
    if (currency) {
      // USD is the base currency — always rate 1.0
      onCurrencyChange(code, code === "USD" ? 1.0 : currency.defaultRate);
    }
  };

  const fetchLiveRate = async () => {
    setFetchingRate(true);
    setRateError(null);
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${sourceCurrency}`);
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const rate = data?.rates?.[targetCurrency];
      if (rate == null) {
        setRateError(`No rate found for ${sourceCurrency} → ${targetCurrency}`);
      } else {
        onChange({ ...constants, currencyRate: parseFloat(rate.toFixed(6)) });
      }
    } catch {
      setRateError("Could not fetch live rate. Check connection.");
    } finally {
      setFetchingRate(false);
    }
  };

  const selectedSourceCurrency = CURRENCIES.find((c) => c.code === sourceCurrency);
  const selectedCurrency = CURRENCIES.find((c) => c.code === targetCurrency);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          Global Constants
        </h3>
        {saving && (
          <span className="text-xs text-gray-400 animate-pulse">Saving…</span>
        )}
      </div>

      {/* Currency selector row */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {/* From currency */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">From Currency</label>
          <Select
            value={sourceCurrency}
            onChange={(next) => onSourceCurrencyChange(next)}
            className={cn(
              "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700",
              "focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30",
              "transition-colors cursor-pointer min-w-[180px]"
            )}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </div>

        <span className="mb-2 text-sm text-gray-400">→</span>

        {/* To currency */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">To Currency</label>
          <Select
            value={targetCurrency}
            onChange={(next) => handleCurrencySelect(next)}
            className={cn(
              "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700",
              "focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30",
              "transition-colors cursor-pointer min-w-[180px]"
            )}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </div>

        {sourceCurrency !== targetCurrency && (
          <button
            type="button"
            onClick={fetchLiveRate}
            disabled={fetchingRate}
            title="Fetch live exchange rate from open.er-api.com"
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium",
              "text-gray-600 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {fetchingRate ? (
              <Spinner size={12} />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {fetchingRate ? "Fetching…" : "Live Rate"}
          </button>
        )}

        {rateError && (
          <span className="text-xs text-rose-500">{rateError}</span>
        )}
        {selectedSourceCurrency && selectedCurrency && sourceCurrency !== targetCurrency && (
          <span className="text-xs text-gray-400">
            Typical: 1 {selectedSourceCurrency.code} ≈ {(selectedCurrency.defaultRate / selectedSourceCurrency.defaultRate).toFixed(4)} {selectedCurrency.code}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CONSTANT_FIELDS.map((field) => (
          <div key={field.key} className="group">
            <label className="mb-1 block text-xs text-gray-500">
              {field.label}
              <span className="ml-1 text-gray-400">({field.description})</span>
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={fieldText(field)}
                onFocus={() => beginEdit(field)}
                onChange={(e) => editChange(field, e.target.value)}
                onBlur={() => endEdit(field)}
                className={cn(
                  "w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-3 pr-7 text-sm font-mono font-medium",
                  "focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/30",
                  "transition-colors",
                  field.color
                )}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                {field.isRate ? "%" : "×"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
