"use client";

/**
 * Financial Proposal — printable multi-page document that mirrors the
 * Word template shipped by sales (Financial_Proposal_Temp.docx).
 *
 * Hard-wired from the quotation / session:
 *   - Ref            ← quotation.ref
 *   - Date           ← quotation.created_at
 *   - Items table    ← quotation.items_json (one combined "Financial
 *                     Proposal" table, not per-system like the long
 *                     /quotation print)
 *   - Totals         ← computeQuotationTotals(items, tax_percent)
 *   - Submitted to   ← quotation.client_name
 *   - Sales name     ← quotation.sales_engineer or session display_name
 *   - Sales phone    ← config.salesPhone or session phone
 *   - Sales email    ← <username>@magictech-jo.com (template convention)
 *
 * Everything else (About Us paragraph, disclaimer, T&C sections) defaults
 * to the template's copy and is inline-editable. Edits persist in
 * localStorage keyed by quotation id so a sales rep can tweak once and
 * keep the override across reloads — defaults remain on every other
 * quotation that hasn't been touched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuotationItem } from "./QuotationPreview";
import {
  computeQuotationTotals,
  effectiveRowTotal,
} from "@/lib/quotationTotals";
import { runQuotationPrint } from "@/lib/printQuotation";
import PageLoader from "./PageLoader";

interface SavedConfig {
  salesPhone?: string;
}

interface SessionMe {
  user: {
    id: number;
    username: string;
    display_name?: string;
    phone?: string;
    role?: string;
  } | null;
}

/** Default sections of the General Terms and Conditions block. */
interface FpSection {
  /** Heading rendered as bold red caps. */
  heading: string;
  /** One or more bullet lines under the heading. */
  bullets: string[];
}

interface FpOverrides {
  salesName?: string;
  salesPhone?: string;
  salesEmail?: string;
  submittedTo?: string;
  coverTitle?: string;
  coverSubtitle?: string;
  aboutUs?: string;
  disclaimer?: string[];
  sections?: FpSection[];
}

const DEFAULT_ABOUT_US =
  "Magic Tech, a leading Jordanian technology company established in 2003, " +
  "specializes in delivering advanced Information and Communication " +
  "Technology (ICT) and low-current solutions across a wide range of " +
  "industries. With a strong commitment to innovation, quality, and " +
  "customer satisfaction, Magic Tech provides comprehensive technology " +
  "services that help organizations enhance security, efficiency, and " +
  "operational performance.\n\n" +
  "Our expertise covers the design, supply, installation, and maintenance " +
  "of integrated technology solutions, including surveillance systems, " +
  "access control and time attendance solutions, smart locks, intrusion " +
  "alarm systems, fire alarm systems, video intercom systems, garage door " +
  "automation, UPS and power backup systems, sound and public address " +
  "solutions, networking infrastructure, as well as computer hardware and " +
  "software solutions.\n\n" +
  "At Magic Tech, we believe that technology is most effective when " +
  "supported by professional expertise. Our team of highly qualified " +
  "engineers and technicians brings extensive industry experience and " +
  "continuously develops their skills through specialized training " +
  "programs and certifications from leading international technology " +
  "vendors. This enables us to deliver reliable, scalable, and " +
  "future-ready solutions tailored to the unique requirements of each " +
  "client.\n\n" +
  "Over the years, Magic Tech has earned a strong reputation as a trusted " +
  "technology partner by consistently providing high-quality products, " +
  "professional implementation services, and exceptional after-sales " +
  "support. Through our dedication to excellence and continuous " +
  "innovation, we strive to build long-term partnerships and deliver " +
  "complete technology solutions that empower businesses, institutions, " +
  "and residential communities throughout Jordan and beyond.";

const DEFAULT_DISCLAIMER = [
  "The information contained in this document is the sole property of " +
    "MagicTech and its affiliated companies. Such information is provided " +
    "in response to specific requests and is based on the information " +
    "available at the time of preparation, as well as MagicTech's standard " +
    "terms and conditions. It is intended solely for the purpose for which " +
    "it has been supplied and should not be relied upon for any other " +
    "purpose.",
  "This document is submitted exclusively for the evaluation of MagicTech " +
    "products, services, and solutions and may only be disclosed to " +
    "employees or authorized representatives of the intended recipient " +
    "who have a legitimate need to access such information.",
  "Every effort has been made to ensure that the information contained in " +
    "this document is accurate and up to date at the time of publication. " +
    "However, products, specifications, services, and other content " +
    "described herein are subject to continuous development and " +
    "improvement. MagicTech reserves the right to modify, update, or " +
    "discontinue any information, product, or service at any time without " +
    "prior notice.",
  "MagicTech shall not be liable for any loss, damage, or consequences " +
    "arising from the use of, or reliance upon, information that may have " +
    "become outdated or inaccurate after publication.",
  "No part of this document may be copied, reproduced, distributed, " +
    "transmitted, stored in a retrieval system, or translated into any " +
    "form or by any means without the prior written consent of MagicTech.",
];

const DEFAULT_SECTIONS: FpSection[] = [
  {
    heading: "NOTES",
    bullets: ["Any additional clarification or information needed you can contact us."],
  },
  {
    heading: "PRICES",
    bullets: [
      "The above prices are in Jordanian Dinar, and the mentioned items and services are excluding sales tax (16%).",
      "Prices of professional services on the mentioned items/systems are Excluded.",
    ],
  },
  {
    heading: "WARRANTY",
    bullets: [
      "Hikvision Warranty",
      "3 years hardware warranty and advanced replacement at no additional cost, a replacement part within Next-Business-Day (NBD) after receipt of the RMA request if available, and otherwise 12-20 weeks, exclude any misusing.",
    ],
  },
  {
    heading: "VALIDITY",
    bullets: ["This offer is valid for 30 days."],
  },
  {
    heading: "DELIVERY",
    bullets: ["10-14 weeks from the PO date."],
  },
  {
    heading: "PAYMENT TERMS",
    bullets: ["As per Islamic International Arab Bank payment terms."],
  },
];

function money(n: number): string {
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function longDate(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(iso);
  }
}

async function fetchJson<T>(url: string): Promise<T | { __error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const raw = await res.text();
    if (!res.ok) return { __error: `${res.status} ${raw.slice(0, 160)}` };
    try {
      return JSON.parse(raw) as T;
    } catch {
      return { __error: "non-JSON response" };
    }
  } catch (err) {
    return { __error: (err as Error).message || "Network error" };
  }
}

export default function FinancialProposalView({
  quotationId,
}: {
  quotationId: number;
}) {
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [me, setMe] = useState<SessionMe["user"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `mt:fp:overrides:${quotationId}`;

  // Hydrate overrides from localStorage. Stays empty server-side so the
  // server render is deterministic.
  const [overrides, setOverridesRaw] = useState<FpOverrides>({});
  const hydratedRef = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setOverridesRaw(JSON.parse(raw) as FpOverrides);
    } catch {
      /* ignore parse errors */
    }
    hydratedRef.current = true;
  }, [storageKey]);

  const setOverrides = useCallback(
    (patch: Partial<FpOverrides> | ((prev: FpOverrides) => FpOverrides)) => {
      setOverridesRaw((prev) => {
        const next =
          typeof patch === "function"
            ? (patch as (p: FpOverrides) => FpOverrides)(prev)
            : { ...prev, ...patch };
        if (hydratedRef.current) {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            /* quota / disabled — silently degrade */
          }
        }
        return next;
      });
    },
    [storageKey],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJson<{ quotation: Record<string, unknown> | null }>(
        `/api/quotations?id=${quotationId}`,
      ),
      fetchJson<SessionMe>(`/api/auth/me`),
    ])
      .then(([qRes, meRes]) => {
        if (cancelled) return;
        if ("__error" in qRes) {
          setError(qRes.__error);
          return;
        }
        if (!qRes.quotation) {
          setError("Quotation not found.");
          return;
        }
        setRow(qRes.quotation);
        if (!("__error" in meRes)) setMe(meRes.user);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  // ── Derived: parsed items + config + auto-fields ──────────────────────
  const { items, config, ref, dateLong, projectName, clientName, taxPercent } =
    useMemo(() => {
      const empty = {
        items: [] as QuotationItem[],
        config: {} as SavedConfig,
        ref: "",
        dateLong: longDate(null),
        projectName: "",
        clientName: "",
        taxPercent: 16,
      };
      if (!row) return empty;
      const rawItems: unknown =
        typeof row.items_json === "string"
          ? (() => {
              try {
                return JSON.parse(row.items_json as string);
              } catch {
                return [];
              }
            })()
          : row.items_json;
      const parsedItems: QuotationItem[] = Array.isArray(rawItems)
        ? (rawItems as QuotationItem[])
        : [];
      const rawCfg: unknown =
        typeof row.config_json === "string"
          ? (() => {
              try {
                return JSON.parse(row.config_json as string);
              } catch {
                return {};
              }
            })()
          : row.config_json;
      const cfg: SavedConfig =
        rawCfg && typeof rawCfg === "object" && !Array.isArray(rawCfg)
          ? (rawCfg as SavedConfig)
          : {};
      return {
        items: parsedItems,
        config: cfg,
        ref: String(row.ref || ""),
        dateLong: longDate(row.created_at as string | null),
        projectName: String(row.project_name || ""),
        clientName: String(row.client_name || ""),
        taxPercent: Number(row.tax_percent || 0) || 16,
      };
    }, [row]);

  const totals = useMemo(
    () => computeQuotationTotals(items, taxPercent, false, null),
    [items, taxPercent],
  );

  // First system name doubles as the cover subtitle (e.g. "CCTV") when
  // the sales rep hasn't typed something specific. Mirrors how the docx
  // template prints "Jordan Bar Association / CCTV".
  const firstSystem = items.find((it) => it.system)?.system || "";

  // Default contact details derived from quotation row + session user.
  const defaultSalesName =
    (row?.sales_engineer as string) || me?.display_name || me?.username || "";
  const defaultSalesPhone = config.salesPhone || me?.phone || "";
  const defaultSalesEmail = me?.username
    ? `${me.username}@magictech-jo.com`
    : "";

  const salesName = overrides.salesName ?? defaultSalesName;
  const salesPhone = overrides.salesPhone ?? defaultSalesPhone;
  const salesEmail = overrides.salesEmail ?? defaultSalesEmail;
  const submittedTo = overrides.submittedTo ?? clientName;
  const coverTitle = overrides.coverTitle ?? projectName;
  const coverSubtitle = overrides.coverSubtitle ?? firstSystem;
  const aboutUs = overrides.aboutUs ?? DEFAULT_ABOUT_US;
  const disclaimer = overrides.disclaimer ?? DEFAULT_DISCLAIMER;
  const sections = overrides.sections ?? DEFAULT_SECTIONS;

  // Flatten items into a single Description column. The docx template
  // shows just one row per line item (no per-system pages), so we
  // collapse brand + model + description into one cell and drop section
  // dividers since they have no commercial value.
  const tableRows = useMemo(() => {
    const out: Array<{
      no: number;
      desc: string;
      qty: number;
      unit: number;
      total: number;
      optional: boolean;
    }> = [];
    let n = 1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "section") continue;
      const descParts = [
        it.brand,
        it.model,
        it.description,
      ]
        .map((s) => (s || "").trim())
        .filter(Boolean);
      const desc =
        descParts.length === 0 ? "—" : descParts.join(" — ");
      const total = effectiveRowTotal(items, i);
      out.push({
        no: n++,
        desc,
        qty: Number(it.quantity) || 0,
        unit: Number(it.unit_price) || 0,
        total,
        optional: Boolean(it.optional),
      });
    }
    return out;
  }, [items]);

  function runPrint() {
    runQuotationPrint({
      ref,
      projectName: projectName || "Financial Proposal",
      kind: "normal",
    });
  }

  function resetOverrides() {
    if (!window.confirm("Reset all sales overrides back to defaults?")) return;
    setOverridesRaw({});
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-8">
        <PageLoader label={`Loading financial proposal #${quotationId}…`} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p className="font-semibold">Failed to load this quotation.</p>
        <p className="mt-1 break-words">{error}</p>
      </div>
    );
  }
  if (!row) return null;

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-magic-ink/60">
          Sales-editable fields underlined; values default to the template /
          quotation data. Edits are remembered for this proposal only.
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetOverrides}
            className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold hover:bg-magic-soft"
            title="Restore every field on this page back to its automatic / template default"
          >
            Reset to defaults
          </button>
          <button
            onClick={runPrint}
            className="rounded-md bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Print / PDF
          </button>
        </div>
      </div>

      <div className="overflow-x-auto print:overflow-x-visible">
        <div className="quotation-doc fp-doc">
          {/* ───── 1. Cover ─────────────────────────────────────────── */}
          <section className="quotation-sheet fp-sheet fp-cover page-break-after">
            <div className="fp-cover-inner">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Magic Tech" className="fp-cover-logo" />
              <div className="fp-cover-band">
                <div className="fp-cover-title">
                  <FpInline
                    value={coverTitle}
                    onChange={(v) => setOverrides({ coverTitle: v })}
                    placeholder="Project name"
                  />
                </div>
                <div className="fp-cover-sub">
                  <FpInline
                    value={coverSubtitle}
                    onChange={(v) => setOverrides({ coverSubtitle: v })}
                    placeholder="System (e.g. CCTV)"
                  />
                </div>
              </div>
              <div className="fp-cover-foot">
                <div>{dateLong}</div>
                <div className="fp-cover-ref">Ref. {ref || "—"}</div>
              </div>
            </div>
          </section>

          {/* ───── 2. Table of Contents ────────────────────────────── */}
          <FpSheet>
            <h1 className="fp-h1">Table of Contents</h1>
            <ol className="fp-toc">
              <li><span>About our Company</span><span>2</span></li>
              <li><span>Contact Details</span><span>3</span></li>
              <li><span>Financial Proposal</span><span>4</span></li>
              <li>
                <span>General Terms and Conditions</span>
                <span>5</span>
              </li>
              <li className="fp-toc-sub"><span>NOTES</span><span>5</span></li>
              <li className="fp-toc-sub"><span>PRICES</span><span>5</span></li>
              <li className="fp-toc-sub"><span>WARRANTY</span><span>5</span></li>
              <li className="fp-toc-sub"><span>VALIDITY</span><span>5</span></li>
              <li className="fp-toc-sub"><span>DELIVERY</span><span>5</span></li>
              <li className="fp-toc-sub"><span>PAYMENT TERMS</span><span>5</span></li>
            </ol>
          </FpSheet>

          {/* ───── 3. About Us + disclaimer ────────────────────────── */}
          <FpSheet>
            <h1 className="fp-h1">
              About <span className="fp-red">our Company.</span>
            </h1>
            <FpTextarea
              value={aboutUs}
              onChange={(v) => setOverrides({ aboutUs: v })}
              className="fp-paragraph"
              rows={18}
            />
          </FpSheet>

          <FpSheet>
            <div className="fp-meta-row">
              <div className="fp-meta-date">{dateLong}</div>
              <div className="fp-meta-ref">Ref. {ref || "—"}</div>
            </div>
            <div className="fp-disclaimer">
              {disclaimer.map((p, i) => (
                <FpTextarea
                  key={i}
                  value={p}
                  onChange={(v) =>
                    setOverrides((prev) => {
                      const next = [...(prev.disclaimer ?? DEFAULT_DISCLAIMER)];
                      next[i] = v;
                      return { ...prev, disclaimer: next };
                    })
                  }
                  className="fp-paragraph"
                  rows={4}
                />
              ))}
            </div>
          </FpSheet>

          {/* ───── 4. Contact Details + Financial Proposal table ──── */}
          <FpSheet>
            <h1 className="fp-h1">Contact Details:</h1>
            <div className="fp-contact">
              <div className="fp-contact-name">
                <FpInline
                  value={salesName}
                  onChange={(v) => setOverrides({ salesName: v })}
                  placeholder="Sales contact name"
                />
              </div>
              <div className="fp-contact-row">
                <FpInline
                  value={salesPhone}
                  onChange={(v) => setOverrides({ salesPhone: v })}
                  placeholder="+962 7X XXX XXXX"
                />
              </div>
              <div className="fp-contact-row">
                <FpInline
                  value={salesEmail}
                  onChange={(v) => setOverrides({ salesEmail: v })}
                  placeholder="name@magictech-jo.com"
                />
              </div>
            </div>

            <h1 className="fp-h1 fp-h1-spaced">Financial Proposal</h1>
            <div className="fp-submitted">
              Submitted to:{" "}
              <FpInline
                value={submittedTo}
                onChange={(v) => setOverrides({ submittedTo: v })}
                placeholder="(…………..)"
              />
            </div>

            <table className="fp-table">
              <thead>
                <tr>
                  <th className="fp-th-desc">Description</th>
                  <th className="fp-th-qty">Qty</th>
                  <th className="fp-th-unit">Unit Cost JOD</th>
                  <th className="fp-th-total">Total Cost JOD</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="fp-empty">
                      No items on this quotation yet.
                    </td>
                  </tr>
                )}
                {tableRows.map((r) => (
                  <tr key={r.no}>
                    <td className="fp-td-desc">
                      <span className="fp-td-no">{r.no}.</span> {r.desc}
                    </td>
                    <td>{r.qty}</td>
                    <td>{money(r.unit)}</td>
                    <td>
                      {r.optional ? (
                        <span className="fp-optional">Optional</span>
                      ) : (
                        money(r.total)
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="fp-total-row">
                  <td colSpan={3} className="fp-total-label">
                    Total Excluding Sales Tax {taxPercent}%
                  </td>
                  <td className="fp-total-value">{money(totals.subtotal)}</td>
                </tr>
                <tr className="fp-total-row fp-total-row-final">
                  <td colSpan={3} className="fp-total-label">
                    Total Including Sales Tax {taxPercent}%
                  </td>
                  <td className="fp-total-value">{money(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </FpSheet>

          {/* ───── 5. General Terms and Conditions ─────────────────── */}
          <FpSheet isLast>
            <h1 className="fp-h1">General Terms and Conditions</h1>
            <div className="fp-sections">
              {sections.map((sec, sIdx) => (
                <div key={sIdx} className="fp-section">
                  <FpInline
                    value={sec.heading}
                    onChange={(v) =>
                      setOverrides((prev) => {
                        const next = [
                          ...(prev.sections ?? DEFAULT_SECTIONS),
                        ].map((s) => ({ ...s, bullets: [...s.bullets] }));
                        next[sIdx] = { ...next[sIdx], heading: v };
                        return { ...prev, sections: next };
                      })
                    }
                    className="fp-section-heading"
                  />
                  <ul className="fp-bullets">
                    {sec.bullets.map((b, bIdx) => (
                      <li key={bIdx}>
                        <FpTextarea
                          value={b}
                          onChange={(v) =>
                            setOverrides((prev) => {
                              const next = [
                                ...(prev.sections ?? DEFAULT_SECTIONS),
                              ].map((s) => ({
                                ...s,
                                bullets: [...s.bullets],
                              }));
                              next[sIdx].bullets[bIdx] = v;
                              return { ...prev, sections: next };
                            })
                          }
                          className="fp-bullet-text"
                          rows={2}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </FpSheet>
        </div>
      </div>
    </div>
  );
}

/**
 * Page wrapper that re-uses the existing .quotation-sheet print plumbing
 * (running header strip with the company logo and the running address
 * footer) so the Financial Proposal pages get the same brand strip and
 * footer on every printed page for free.
 */
function FpSheet({
  isLast,
  children,
}: {
  isLast?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`quotation-sheet fp-sheet text-[11px] ${
        isLast ? "" : "page-break-after"
      }`}
    >
      <table className="sheet-layout">
        <thead>
          <tr>
            <td>
              <div className="fp-brand-strip">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="Magic Tech" />
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="sheet-body-cell">{children}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>
              <div className="footer-address">
                COPYRIGHT © 2003-{new Date().getFullYear()} MAGIC TECH FOR
                COMPUTERS. ALL RIGHTS RESERVED.
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

/** Single-line inline editable field. Underlined when editable. */
function FpInline({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`fp-inline ${className || ""}`}
    />
  );
}

/** Multi-line inline editable field. Auto-grows to fit content on screen. */
function FpTextarea({
  value,
  onChange,
  rows,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows ?? 3}
      className={`fp-textarea ${className || ""}`}
    />
  );
}
