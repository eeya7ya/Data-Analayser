"use client";

/**
 * Technical Proposal — printable multi-page document that mirrors the
 * Word template (Technical_Proposal_Temp.docx). Heavier than the
 * Financial Proposal: every illustration is click-to-upload, every text
 * block is inline-editable, and the Bill of Materials auto-enriches
 * each row with the catalogue's detailed product description so the
 * presales engineer doesn't have to copy-paste specs by hand.
 *
 * Smart wiring:
 *   - Cover         ← project_name + first system + created_at
 *   - Ref / Date    ← quotation.ref / created_at
 *   - Contact       ← signed-in generator: name / phone / email from the
 *                     session, position from their CRM module role
 *                     (presales → Presales Engineer, sales → Sales
 *                     Engineer, *_manager → Manager)
 *   - BoM           ← items_json, enriched with catalogue description /
 *                     fast_view / specifications / picture via
 *                     /api/catalogue/lookup
 *   - Product Overview ← one card per BoM row using the same lookup
 *   - Country of Origin ← auto-listed from the vendors detected in BoM
 *   - References    ← editable table, seeded with the template default
 *   - Diagram / Cert / Manager / Team images ← click-to-upload, stored
 *     as compressed data URLs in localStorage scoped to the quotation
 *
 * Everything not auto-wired defaults to the template's copy and can be
 * overridden inline; overrides persist per-quotation in localStorage
 * so a one-off tweak survives reloads without polluting other
 * proposals.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuotationItem } from "./QuotationPreview";
import { runQuotationPrint } from "@/lib/printQuotation";
import PageLoader from "./PageLoader";
import EditableImage from "./EditableImage";

interface SavedConfig {
  salesPhone?: string;
}

interface SessionMe {
  user: {
    id: number;
    username: string;
    display_name?: string;
    phone?: string;
  } | null;
  module_roles?: Array<{ module: string; role: string }>;
}

interface CatalogueProduct {
  id: number;
  vendor: string;
  system: string;
  category: string;
  sub_category: string;
  fast_view: string;
  model: string;
  description: string;
  specifications: string;
  picture_url: string | null;
}

interface ReferenceRow {
  customer: string;
  contact: string;
  email: string;
  project: string;
}

interface FpSection {
  heading: string;
  bullets: string[];
}

interface TpOverrides {
  // contact
  salesName?: string;
  salesPosition?: string;
  salesPhone?: string;
  salesEmail?: string;
  // cover
  customerName?: string;
  projectTitle?: string;
  // text blocks
  aboutUs?: string;
  disclaimer?: string[];
  solutionOverview?: string;
  networkDiagramNote?: string;
  storageParamsNote?: string;
  notesAssumptions?: string;
  generalNotes?: string;
  serviceContract?: string;
  localSupport?: string;
  serviceLevel?: string;
  teamCapabilities?: string;
  // images
  authorizedCertImage?: string;
  networkDiagramImage?: string;
  storageParamsImage?: string;
  notesImage?: string;
  productOverviewExtras?: string[];
  teamCertImage?: string;
  projectManagerImage?: string;
  referencesImage?: string;
  // references
  references?: ReferenceRow[];
  // T&C
  sections?: FpSection[];
  // BoM service duration overrides (months) keyed by row no
  bomDurations?: Record<number, number>;
  // BoM description overrides (when the catalogue lookup isn't enough)
  bomDescriptions?: Record<number, string>;
}

// ─── Default content (mirrors the docx template) ──────────────────────────

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
  "vendors.\n\n" +
  "Over the years, Magic Tech has earned a strong reputation as a trusted " +
  "technology partner by consistently providing high-quality products, " +
  "professional implementation services, and exceptional after-sales " +
  "support.";

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

const DEFAULT_SOLUTION_OVERVIEW =
  "Introduction about the solution… Briefly describe the engineered " +
  "approach: which systems are being deployed, why the chosen products " +
  "fit the project's operational requirements, and how the design " +
  "delivers reliability, scalability and value for the client.";

const DEFAULT_SERVICE_CONTRACT =
  "Magic Tech offers a tailored Service Contract covering preventive " +
  "maintenance visits, priority remote support, and on-site response for " +
  "the duration of the agreement. The scope is sized to the project's " +
  "criticality and can be extended annually.";

const DEFAULT_LOCAL_SUPPORT =
  "All deployed systems are backed by Magic Tech's local support team " +
  "operating out of Amman, with same-day phone and email response and " +
  "next-business-day on-site dispatch for issues that cannot be resolved " +
  "remotely.";

const DEFAULT_SERVICE_LEVEL =
  "*This will be added based on the project.";

const DEFAULT_TEAM =
  "Magic Tech's Low Current team holds major vendor certifications " +
  "across the product lines included in this proposal, with regularly " +
  "renewed training so the deployed systems are commissioned to the " +
  "manufacturer's best-practice guidelines.";

const DEFAULT_REFERENCES: ReferenceRow[] = [
  {
    customer: "Cementra",
    contact: "Osama Almashakbeh",
    email: "O.Almashakbeh@cementra.com",
    project: "CCTV, Structured Cabling & Solutions",
  },
];

const DEFAULT_SECTIONS: FpSection[] = [
  {
    heading: "DELIVERY",
    bullets: [
      "8 - 12 weeks from receipt of your written Purchase Order.",
      "Passive: 3-5 weeks from the PO date.",
      "Hikvision: 8-12 weeks from the PO date.",
    ],
  },
  {
    heading: "INSTALLATION",
    bullets: [
      "Installation will proceed according to a mutually agreed project plan. If there is a delay from the customer's side exceeding one month, the project will be considered finally accepted for contractual purposes. However, Magictech will remain committed to installing the systems once the customer is ready.",
      "Magictech is not responsible for any design issues or for any missing hardware, software, or licenses.",
      "Cable and passive components are not included in this proposal.",
    ],
  },
  {
    heading: "COUNTRY OF ORIGINS",
    bullets: [
      "CCTV: Hikvision — China.",
      "Active: Planet — China.",
      "Cables: ETK — Turkey.",
    ],
  },
  {
    heading: "WARRANTY",
    bullets: [
      "Passive Warranty: 20 years' warranty that provides next-day advance hardware replacement, if available, otherwise 45 days from RMA date.",
      "Hikvision Warranty: 3 years' hardware warranty for cameras replacement at no additional cost, a replacement part within Next-Business-Day (NBD) after receipt of the RMA request if available, and otherwise 45 days, excluding any misuse.",
      "Planet Warranty: 3 years' hardware warranty for networks replacement at no additional cost, a replacement part within Next-Business-Day (NBD) after receipt of the RMA request if available, and otherwise 45 days, exclude any misusing.",
    ],
  },
  {
    heading: "VALIDITY",
    bullets: [
      "This offer is valid for 45 calendar days from the date of issuance or until stock is exhausted, whichever comes first.",
    ],
  },
];

function longDate(iso: string | null | undefined): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  if (!iso) return fmt(new Date());
  try {
    return fmt(new Date(iso));
  } catch {
    return String(iso);
  }
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T | { __error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
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

export default function TechnicalProposalView({
  quotationId,
}: {
  quotationId: number;
}) {
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [me, setMe] = useState<SessionMe["user"]>(null);
  const [meRoles, setMeRoles] = useState<
    Array<{ module: string; role: string }>
  >([]);
  const [catalogue, setCatalogue] = useState<Record<string, CatalogueProduct>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storageKey = `mt:tp:overrides:${quotationId}`;
  const [overrides, setOverridesRaw] = useState<TpOverrides>({});
  const hydratedRef = useRef(false);

  // Central, admin-managed company images (Admin → Technical Proposal). Each
  // image below falls back to the central one when this proposal has no
  // per-proposal override.
  const [central, setCentral] = useState<{
    authorizedCert: string;
    teamCerts: string;
    pmCert: string;
    references: string;
  }>({ authorizedCert: "", teamCerts: "", pmCert: "", references: "" });
  useEffect(() => {
    let alive = true;
    void fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { settings?: { techProposalAssets?: typeof central } }) => {
        if (alive && d.settings?.techProposalAssets)
          setCentral((c) => ({ ...c, ...d.settings!.techProposalAssets }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Hydrate persisted overrides on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setOverridesRaw(JSON.parse(raw) as TpOverrides);
    } catch {
      /* ignore */
    }
    hydratedRef.current = true;
  }, [storageKey]);

  const setOverrides = useCallback(
    (
      patch:
        | Partial<TpOverrides>
        | ((prev: TpOverrides) => TpOverrides),
    ) => {
      setOverridesRaw((prev) => {
        const next =
          typeof patch === "function"
            ? (patch as (p: TpOverrides) => TpOverrides)(prev)
            : { ...prev, ...patch };
        if (hydratedRef.current) {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            /* quota — silently degrade */
          }
        }
        return next;
      });
    },
    [storageKey],
  );

  // Load quotation + session.
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
        if (!("__error" in meRes)) {
          setMe(meRes.user);
          setMeRoles(meRes.module_roles || []);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  // Parse items + config once row is loaded.
  const {
    items,
    config,
    ref,
    dateLong,
    projectName,
    clientName,
  } = useMemo(() => {
    const empty = {
      items: [] as QuotationItem[],
      config: {} as SavedConfig,
      ref: "",
      dateLong: longDate(null),
      projectName: "",
      clientName: "",
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
    };
  }, [row]);

  // Bulk-fetch catalogue records for every model on the quotation in one
  // round trip, so the BoM and Product Overview can render rich
  // descriptions / pictures without the user typing anything.
  useEffect(() => {
    if (items.length === 0) return;
    const models = Array.from(
      new Set(
        items
          .filter((it) => it.kind !== "section")
          .map((it) => (it.model || "").trim())
          .filter((m) => m.length > 0),
      ),
    );
    if (models.length === 0) return;
    let cancelled = false;
    setEnriching(true);
    fetchJson<{ products: Record<string, CatalogueProduct> }>(
      "/api/catalogue/lookup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ models }),
      },
    )
      .then((res) => {
        if (cancelled) return;
        if ("__error" in res) return;
        setCatalogue(res.products || {});
      })
      .finally(() => {
        if (!cancelled) setEnriching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [items]);

  // Build the flattened BoM rows (one row per item, no per-system pages).
  const bom = useMemo(() => {
    const out: Array<{
      no: number;
      model: string;
      qty: number;
      vendor: string;
      catalogueDescription: string;
      fast_view: string;
      specifications: string;
      picture: string;
      defaultDuration: number;
    }> = [];
    let n = 1;
    for (const it of items) {
      if (it.kind === "section") continue;
      const model = (it.model || "").trim();
      const cat = catalogue[model.toLowerCase()] || null;
      // Service duration default: 36 months for active equipment (the
      // first BoM row in the template uses 36) — but vendors known to
      // ship 12-month support default lower. Sales can override per row.
      const vendor = cat?.vendor || it.brand || "";
      const defaultDuration =
        /hik|planet|aruba/i.test(vendor || "") ? 36 : 12;
      out.push({
        no: n++,
        model,
        qty: Number(it.quantity) || 0,
        vendor,
        catalogueDescription: cat?.description || "",
        fast_view: cat?.fast_view || "",
        specifications: cat?.specifications || "",
        picture: cat?.picture_url || it.picture_url || "",
        defaultDuration,
      });
    }
    return out;
  }, [items, catalogue]);

  // Contact card belongs to whoever is GENERATING this proposal — the
  // signed-in user, not the engineer stamped on the quotation. Their CRM
  // grant decides the printed position: a presales user signs as Presales
  // Engineer, a sales user as Sales Engineer (manager grants print the
  // manager title). Users wearing both hats — and admins with no CRM
  // grant — keep the combined label.
  const crmRoles = meRoles
    .filter((g) => g.module === "crm")
    .map((g) => g.role);
  const isPresalesUser =
    crmRoles.includes("presales") || crmRoles.includes("presales_manager");
  const isSalesUser =
    crmRoles.includes("sales") || crmRoles.includes("sales_manager");
  const defaultPosition =
    isPresalesUser && !isSalesUser
      ? crmRoles.includes("presales_manager")
        ? "Presales Manager"
        : "Presales Engineer"
      : isSalesUser && !isPresalesUser
        ? crmRoles.includes("sales_manager")
          ? "Sales Manager"
          : "Sales Engineer"
        : "Sales / Presales Engineer";

  const defaultSalesName =
    me?.display_name || me?.username || (row?.sales_engineer as string) || "";
  const defaultSalesPhone = me?.phone || config.salesPhone || "";
  const defaultSalesEmail = me?.username
    ? `${me.username}@magictech-jo.com`
    : "";

  const salesName = overrides.salesName ?? defaultSalesName;
  const salesPosition = overrides.salesPosition ?? defaultPosition;
  const salesPhone = overrides.salesPhone ?? defaultSalesPhone;
  const salesEmail = overrides.salesEmail ?? defaultSalesEmail;

  const firstSystem = items.find((it) => it.system)?.system || "";
  const customerName = overrides.customerName ?? clientName;
  const projectTitle = overrides.projectTitle ?? (firstSystem || projectName);

  const aboutUs = overrides.aboutUs ?? DEFAULT_ABOUT_US;
  const disclaimer = overrides.disclaimer ?? DEFAULT_DISCLAIMER;
  const solutionOverview =
    overrides.solutionOverview ?? DEFAULT_SOLUTION_OVERVIEW;
  const networkDiagramNote = overrides.networkDiagramNote ?? "—";
  const storageParamsNote = overrides.storageParamsNote ?? "—";
  const notesAssumptions = overrides.notesAssumptions ?? "—";
  const serviceContract = overrides.serviceContract ?? DEFAULT_SERVICE_CONTRACT;
  const localSupport = overrides.localSupport ?? DEFAULT_LOCAL_SUPPORT;
  const generalNotes = overrides.generalNotes ?? "";
  const serviceLevel = overrides.serviceLevel ?? DEFAULT_SERVICE_LEVEL;
  const teamCapabilities = overrides.teamCapabilities ?? DEFAULT_TEAM;
  const references = overrides.references ?? DEFAULT_REFERENCES;

  // Auto-derive Country of Origins from the vendors actually present on
  // the BoM. Reuses the editable T&C sections; if the user hasn't
  // touched the sections yet, we splice in the auto-detected list.
  const sectionsBase = overrides.sections ?? DEFAULT_SECTIONS;
  const sections = useMemo(() => {
    if (overrides.sections) return overrides.sections;
    const vendors = Array.from(
      new Set(
        bom.map((r) => r.vendor).filter((v): v is string => Boolean(v && v.trim())),
      ),
    );
    if (vendors.length === 0) return sectionsBase;
    const next = sectionsBase.map((s) =>
      s.heading === "COUNTRY OF ORIGINS"
        ? {
            ...s,
            bullets: vendors.map(
              (v) => `${v} — see manufacturer's country of origin.`,
            ),
          }
        : s,
    );
    return next;
  }, [overrides.sections, sectionsBase, bom]);

  function bomDuration(no: number, defaultMonths: number): number {
    return overrides.bomDurations?.[no] ?? defaultMonths;
  }
  function bomDescription(
    no: number,
    catalogueDescription: string,
    model: string,
    fastView: string,
  ): string {
    const cataloged =
      catalogueDescription ||
      fastView ||
      (model ? `${model} — see datasheet for full specifications.` : "");
    return overrides.bomDescriptions?.[no] ?? cataloged;
  }

  function runPrint() {
    runQuotationPrint({
      ref,
      projectName: projectName || "Technical Proposal",
      kind: "normal",
    });
  }

  function resetOverrides() {
    if (!window.confirm("Reset every override on this Technical Proposal?"))
      return;
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
        <PageLoader label={`Loading technical proposal #${quotationId}…`} />
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
      <div className="no-print sticky top-[60px] z-30 mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-2 rounded-xl border border-magic-border bg-white px-4 py-2.5 shadow-md">
        <div className="text-xs text-magic-ink/60">
          {enriching
            ? "Loading catalogue details for each model…"
            : "Every image and text block is editable; the Bill of Materials pulls detailed descriptions from the catalogue. Edits persist for this proposal only."}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetOverrides}
            className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold hover:bg-magic-soft"
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
              <div className="fp-cover-middle">
                <div className="fp-cover-band">
                  <div className="tp-cover-customer">
                    <TpInline
                      value={customerName}
                      onChange={(v) => setOverrides({ customerName: v })}
                      placeholder="Customer Name"
                    />
                  </div>
                  <div className="tp-cover-exp">
                    Exp:{" "}
                    <TpInline
                      value={projectTitle}
                      onChange={(v) => setOverrides({ projectTitle: v })}
                      placeholder="Project / system (e.g. Galaxy Access Control)"
                    />
                  </div>
                </div>
                <div className="fp-cover-foot">
                  <div>{dateLong}</div>
                  <div className="fp-cover-ref">Technical Proposal</div>
                </div>
              </div>
            </div>
          </section>

          {/* ───── 2. Table of Contents ────────────────────────────── */}
          <TpSheet>
            <h1 className="fp-h1">Table of Contents</h1>
            <ol className="fp-toc">
              <li><span>Contact Details</span><span>3</span></li>
              <li><span>Magictech Authorized Certificate</span><span>4</span></li>
              <li><span>Solution Overview</span><span>5</span></li>
              <li className="fp-toc-sub"><span>Network Diagram / Plan / CCTV Diagram</span><span>5</span></li>
              <li className="fp-toc-sub"><span>Storage Parameters</span><span>5</span></li>
              <li className="fp-toc-sub"><span>Notes / Assumptions</span><span>5</span></li>
              <li><span>Bill of Materials</span><span>6</span></li>
              <li><span>Product Overview</span><span>7</span></li>
              <li><span>Service Contract</span><span>8</span></li>
              <li className="fp-toc-sub"><span>Magictech Local Support</span><span>8</span></li>
              <li className="fp-toc-sub"><span>Service Level Requirements</span><span>9</span></li>
              <li><span>Technical Team Capabilities</span><span>10</span></li>
              <li className="fp-toc-sub"><span>Major Certificates</span><span>10</span></li>
              <li className="fp-toc-sub"><span>Project Manager Certificate</span><span>11</span></li>
              <li><span>MagicTech References</span><span>12</span></li>
              <li><span>General Terms and Conditions</span><span>13</span></li>
            </ol>
          </TpSheet>

          {/* ───── 3. About Us ─────────────────────────────────────── */}
          <TpSheet>
            <h1 className="fp-h1">
              About <span className="fp-red">our Company.</span>
            </h1>
            <TpTextarea
              value={aboutUs}
              onChange={(v) => setOverrides({ aboutUs: v })}
              className="fp-paragraph"
              rows={20}
            />
          </TpSheet>

          {/* ───── 4. Date + Ref + Disclaimer ──────────────────────── */}
          <TpSheet>
            <div className="fp-meta-row">
              <div className="fp-meta-date">{dateLong}</div>
              <div className="fp-meta-ref">Ref. {ref || "—"}</div>
            </div>
            <div className="fp-disclaimer">
              {disclaimer.map((p, i) => (
                <TpTextarea
                  key={i}
                  value={p}
                  onChange={(v) =>
                    setOverrides((prev) => {
                      const next = [
                        ...(prev.disclaimer ?? DEFAULT_DISCLAIMER),
                      ];
                      next[i] = v;
                      return { ...prev, disclaimer: next };
                    })
                  }
                  className="fp-paragraph"
                  rows={4}
                />
              ))}
            </div>
          </TpSheet>

          {/* ───── 5. Contact Details ──────────────────────────────── */}
          <TpSheet>
            <h1 className="fp-h1">Contact Details:</h1>
            <div className="fp-contact">
              <div className="fp-contact-name">
                <TpInline
                  value={salesName}
                  onChange={(v) => setOverrides({ salesName: v })}
                  placeholder="Name"
                />
              </div>
              <div className="fp-contact-row tp-contact-pos">
                <TpInline
                  value={salesPosition}
                  onChange={(v) => setOverrides({ salesPosition: v })}
                  placeholder="Position"
                />
              </div>
              <div className="fp-contact-row">
                <TpInline
                  value={salesPhone}
                  onChange={(v) => setOverrides({ salesPhone: v })}
                  placeholder="+962 -------"
                />
              </div>
              <div className="fp-contact-row">
                <TpInline
                  value={salesEmail}
                  onChange={(v) => setOverrides({ salesEmail: v })}
                  placeholder="name@magictech-jo.com"
                />
              </div>
            </div>
          </TpSheet>

          {/* ───── 6. Magictech Authorized Certificate ─────────────── */}
          <TpSheet>
            <h1 className="fp-h1">Magictech Authorized Certificate</h1>
            <p className="tp-note">
              * Please note this must be requested per project.
            </p>
            <EditableImage
              value={overrides.authorizedCertImage || central.authorizedCert || ""}
              onChange={(v) => setOverrides({ authorizedCertImage: v })}
              placeholder="Click to upload the authorized certificate image"
              height="22rem"
            />
          </TpSheet>

          {/* ───── 7. Solution Overview ────────────────────────────── */}
          <TpSheet>
            <h1 className="fp-h1">Solution Overview</h1>
            <TpTextarea
              value={solutionOverview}
              onChange={(v) => setOverrides({ solutionOverview: v })}
              className="fp-paragraph"
              rows={6}
            />

            <h2 className="tp-h2">Network Diagram / Plan / CCTV Diagram</h2>
            <EditableImage
              value={overrides.networkDiagramImage || ""}
              onChange={(v) => setOverrides({ networkDiagramImage: v })}
              placeholder="Click to upload the network / CCTV diagram"
              height="16rem"
            />
            <TpTextarea
              value={networkDiagramNote}
              onChange={(v) => setOverrides({ networkDiagramNote: v })}
              className="fp-paragraph tp-paragraph-tight"
              rows={2}
            />

            <h2 className="tp-h2">Storage Parameters</h2>
            <EditableImage
              value={overrides.storageParamsImage || ""}
              onChange={(v) => setOverrides({ storageParamsImage: v })}
              placeholder="Click to upload the storage-sizing screenshot"
              height="12rem"
            />
            <TpTextarea
              value={storageParamsNote}
              onChange={(v) => setOverrides({ storageParamsNote: v })}
              className="fp-paragraph tp-paragraph-tight"
              rows={2}
            />

            <h2 className="tp-h2">Notes / Assumptions</h2>
            <TpTextarea
              value={notesAssumptions}
              onChange={(v) => setOverrides({ notesAssumptions: v })}
              className="fp-paragraph"
              rows={4}
            />
            <EditableImage
              value={overrides.notesImage || ""}
              onChange={(v) => setOverrides({ notesImage: v })}
              placeholder="Optional — upload a supporting note image"
              height="9rem"
            />
          </TpSheet>

          {/* ───── 8. Bill of Materials ────────────────────────────── */}
          <TpSheet>
            <h1 className="fp-h1">Bill of Materials</h1>
            {bom.length === 0 ? (
              <p className="tp-note">No items on this quotation yet.</p>
            ) : (
              <table className="tp-bom-table">
                <thead>
                  <tr>
                    <th className="tp-bom-th-no">#</th>
                    <th className="tp-bom-th-part">Part Number</th>
                    <th className="tp-bom-th-desc">Part Description</th>
                    <th className="tp-bom-th-dur">Service Duration</th>
                    <th className="tp-bom-th-qty">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((r) => (
                    <tr key={r.no}>
                      <td>{r.no}</td>
                      <td className="tp-bom-td-part">
                        <div className="tp-bom-part-num">{r.model || "—"}</div>
                        {r.vendor && (
                          <div className="tp-bom-part-vendor">{r.vendor}</div>
                        )}
                      </td>
                      <td className="tp-bom-td-desc">
                        <TpTextarea
                          value={bomDescription(
                            r.no,
                            r.catalogueDescription,
                            r.model,
                            r.fast_view,
                          )}
                          onChange={(v) =>
                            setOverrides((prev) => ({
                              ...prev,
                              bomDescriptions: {
                                ...(prev.bomDescriptions || {}),
                                [r.no]: v,
                              },
                            }))
                          }
                          className="tp-bom-desc-text"
                          rows={4}
                        />
                        {r.specifications && (
                          <details className="no-print tp-bom-specs">
                            <summary>Show full specifications</summary>
                            <pre>{r.specifications}</pre>
                          </details>
                        )}
                      </td>
                      <td className="tp-bom-td-dur">
                        <input
                          type="number"
                          min={1}
                          value={bomDuration(r.no, r.defaultDuration)}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setOverrides((prev) => ({
                              ...prev,
                              bomDurations: {
                                ...(prev.bomDurations || {}),
                                [r.no]: Number.isFinite(v) && v > 0 ? v : 1,
                              },
                            }));
                          }}
                          className="tp-bom-dur-input"
                        />
                        <span className="tp-bom-dur-unit">mo.</span>
                      </td>
                      <td>{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TpSheet>

          {/* ───── 9. Product Overview ────────────────────────────── */}
          <TpSheet>
            <h1 className="fp-h1">Product Overview</h1>
            <p className="tp-note">
              Click any picture to upload a replacement; defaults are pulled
              from the catalogue.
            </p>
            <div className="tp-product-grid">
              {bom.map((r, idx) => {
                const extras = overrides.productOverviewExtras || [];
                const override = extras[idx] || "";
                const src = override || r.picture;
                return (
                  <div key={`${r.no}-${r.model}`} className="tp-product-card">
                    <EditableImage
                      value={src}
                      onChange={(v) => {
                        setOverrides((prev) => {
                          const next = [
                            ...(prev.productOverviewExtras || []),
                          ];
                          // Pad with empty strings up to idx so indices line
                          // up with the BoM row order.
                          while (next.length <= idx) next.push("");
                          next[idx] = v;
                          return { ...prev, productOverviewExtras: next };
                        });
                      }}
                      placeholder="Add product image"
                      height="9rem"
                    />
                    <div className="tp-product-name">{r.model || "—"}</div>
                    <div className="tp-product-desc">
                      {r.fast_view || r.catalogueDescription || ""}
                    </div>
                  </div>
                );
              })}
              {bom.length === 0 && (
                <p className="tp-note">
                  Product cards will appear here once the quotation has items.
                </p>
              )}
            </div>
          </TpSheet>

          {/* ───── 10. Service contract / Local Support ─────────────── */}
          <TpSheet>
            <h1 className="fp-h1">Service Contract</h1>
            <TpTextarea
              value={serviceContract}
              onChange={(v) => setOverrides({ serviceContract: v })}
              className="fp-paragraph"
              rows={5}
            />
            <h2 className="tp-h2">Magictech Local Support</h2>
            <TpTextarea
              value={localSupport}
              onChange={(v) => setOverrides({ localSupport: v })}
              className="fp-paragraph"
              rows={5}
            />
            <h2 className="tp-h2">Service Level Requirements</h2>
            <TpTextarea
              value={serviceLevel}
              onChange={(v) => setOverrides({ serviceLevel: v })}
              className="fp-paragraph"
              rows={3}
            />
          </TpSheet>

          {/* ───── 11. Technical Team Capabilities + Certs ─────────── */}
          <TpSheet>
            <h1 className="fp-h1">Technical Team Capabilities</h1>
            <TpTextarea
              value={teamCapabilities}
              onChange={(v) => setOverrides({ teamCapabilities: v })}
              className="fp-paragraph"
              rows={4}
            />
            <h2 className="tp-h2">Magictech Low Current Team Major Certificates</h2>
            <EditableImage
              value={overrides.teamCertImage || central.teamCerts || ""}
              onChange={(v) => setOverrides({ teamCertImage: v })}
              placeholder="Click to upload the team certificates collage"
              height="14rem"
            />
            <h2 className="tp-h2">Project Manager Certificate</h2>
            <EditableImage
              value={overrides.projectManagerImage || central.pmCert || ""}
              onChange={(v) => setOverrides({ projectManagerImage: v })}
              placeholder="Click to upload the Project Manager's certificate"
              height="14rem"
            />
          </TpSheet>

          {/* ───── 12. MagicTech References ────────────────────────── */}
          <TpSheet>
            <h1 className="fp-h1">MagicTech References</h1>
            <p className="fp-paragraph">
              Magictech has many references in different fields for
              implementation projects, managed services for the whole network,
              and service contracts.
            </p>
            <table className="tp-ref-table">
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Contact Person</th>
                  <th>Email Address</th>
                  <th>Project</th>
                </tr>
              </thead>
              <tbody>
                {references.map((rRow, idx) => (
                  <tr key={idx}>
                    {(
                      [
                        "customer",
                        "contact",
                        "email",
                        "project",
                      ] as Array<keyof ReferenceRow>
                    ).map((key) => (
                      <td key={key}>
                        <TpInline
                          value={rRow[key]}
                          onChange={(v) =>
                            setOverrides((prev) => {
                              const next = [
                                ...(prev.references ?? DEFAULT_REFERENCES),
                              ].map((x) => ({ ...x }));
                              next[idx] = { ...next[idx], [key]: v };
                              return { ...prev, references: next };
                            })
                          }
                          placeholder="—"
                        />
                      </td>
                    ))}
                    <td className="no-print tp-ref-actions">
                      <button
                        type="button"
                        onClick={() =>
                          setOverrides((prev) => {
                            const next = [
                              ...(prev.references ?? DEFAULT_REFERENCES),
                            ].map((x) => ({ ...x }));
                            next.splice(idx, 1);
                            return {
                              ...prev,
                              references: next.length > 0 ? next : [],
                            };
                          })
                        }
                        className="tp-ref-remove"
                        title="Remove this reference row"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={() =>
                setOverrides((prev) => {
                  const next = [
                    ...(prev.references ?? DEFAULT_REFERENCES),
                  ].map((x) => ({ ...x }));
                  next.push({ customer: "", contact: "", email: "", project: "" });
                  return { ...prev, references: next };
                })
              }
              className="no-print mt-2 rounded-md border border-magic-border px-3 py-1 text-[11px] hover:bg-magic-soft"
            >
              + Add reference
            </button>
            {(overrides.referencesImage || central.references) && (
              <div className="mt-4">
                <EditableImage
                  value={overrides.referencesImage || central.references || ""}
                  onChange={(v) => setOverrides({ referencesImage: v })}
                  placeholder="References image"
                  height="16rem"
                />
              </div>
            )}
          </TpSheet>

          {/* ───── 13. General Terms and Conditions ─────────────────── */}
          <TpSheet isLast>
            <h1 className="fp-h1">General Terms and Conditions</h1>
            <div className="fp-sections">
              {sections.map((sec, sIdx) => (
                <div key={sIdx} className="fp-section">
                  <TpInline
                    value={sec.heading}
                    onChange={(v) =>
                      setOverrides((prev) => {
                        const next = [
                          ...(prev.sections ?? sections),
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
                        <TpTextarea
                          value={b}
                          onChange={(v) =>
                            setOverrides((prev) => {
                              const next = [
                                ...(prev.sections ?? sections),
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

            {/* General Notes — a free-text note to the client, under T&C. */}
            <div className="fp-section" style={{ marginTop: 14 }}>
              <div className="fp-section-heading">General Notes</div>
              <TpTextarea
                value={generalNotes}
                onChange={(v) => setOverrides({ generalNotes: v })}
                className="fp-bullet-text"
                rows={4}
                placeholder="Add a general note for the client…"
              />
            </div>
          </TpSheet>
        </div>
      </div>
    </div>
  );
}

/** Page wrapper that reuses the .quotation-sheet print plumbing. */
function TpSheet({
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

function TpInline({
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

function TpTextarea({
  value,
  onChange,
  rows,
  className,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  className?: string;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows ?? 3}
      placeholder={placeholder}
      className={`fp-textarea ${className || ""}`}
    />
  );
}
