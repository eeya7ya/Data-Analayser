"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  ClipboardList,
  Boxes,
  FolderKanban,
  Tags,
  ChevronLeft,
  Building2,
  User,
  type LucideIcon,
} from "lucide-react";
import CrmSearch from "@/components/CrmSearch";

/**
 * The CRM hub. Tools are the role lifecycles (Sales / Presales /
 * Storage / Projects / Pricing). Companies + individual clients are NOT
 * a separate tool — they're woven into the Sales / Presales / Projects
 * tools because that's where client work actually happens.
 *
 * A user who holds a single role lands straight on that tool — the tool
 * picker only appears when more than one tool is available (admins /
 * multi-role users).
 */

export interface CrmHubFlags {
  sales: boolean;
  presales: boolean;
  storage: boolean;
  projects: boolean;
  /** projects.manager — sees the handoff-assignment queue. */
  projectsManager: boolean;
  /** crm.sales_manager — sees the Approvals queue (sales-only sign-off). */
  salesManager: boolean;
  /** crm.presales_manager — kept for role display; no longer distributes. */
  presalesManager: boolean;
  pricing: boolean;
}

export interface CrmHubCounts {
  companies: number;
  companyClients: number;
  individuals: number;
  companyQuotations: number;
  individualQuotations: number;
}

interface EntryCard {
  href: string;
  title: string;
  desc: string;
}

type TabId = "sales" | "presales" | "storage" | "projects" | "pricing";

interface Tone {
  chip: string;
  grad: string;
  border: string;
  text: string;
  solid: string;
}

const TONES: Record<TabId, Tone> = {
  sales: {
    chip: "bg-indigo-100 text-indigo-600",
    grad: "from-indigo-50",
    border: "hover:border-indigo-400",
    text: "text-indigo-600",
    solid: "bg-indigo-600",
  },
  presales: {
    chip: "bg-cyan-100 text-cyan-600",
    grad: "from-cyan-50",
    border: "hover:border-cyan-400",
    text: "text-cyan-600",
    solid: "bg-cyan-600",
  },
  storage: {
    chip: "bg-amber-100 text-amber-600",
    grad: "from-amber-50",
    border: "hover:border-amber-400",
    text: "text-amber-600",
    solid: "bg-amber-500",
  },
  projects: {
    chip: "bg-violet-100 text-violet-600",
    grad: "from-violet-50",
    border: "hover:border-violet-400",
    text: "text-violet-600",
    solid: "bg-violet-600",
  },
  pricing: {
    chip: "bg-emerald-100 text-emerald-600",
    grad: "from-emerald-50",
    border: "hover:border-emerald-400",
    text: "text-emerald-600",
    solid: "bg-emerald-600",
  },
};

const TAB_META: Record<TabId, { label: string; icon: LucideIcon; blurb: string }> = {
  sales: {
    label: "Sales",
    icon: Briefcase,
    blurb: "Your clients and your sales pipeline.",
  },
  presales: {
    label: "Presales",
    icon: ClipboardList,
    blurb: "The shared lead queue, your clients, and pricing → quotation.",
  },
  storage: {
    label: "Storage",
    icon: Boxes,
    blurb: "The product catalogue and stock management.",
  },
  projects: {
    label: "Projects",
    icon: FolderKanban,
    blurb: "Clients, your projects, and handoffs awaiting a member.",
  },
  pricing: {
    label: "Pricing",
    icon: Tags,
    blurb: "Per-manufacturer pricing workspaces and comparisons.",
  },
};

// Which tools include the client (company / individual) drill-down.
const TOOLS_WITH_CLIENTS: ReadonlySet<TabId> = new Set<TabId>([
  "sales",
  "presales",
  "projects",
]);

export default function CrmModuleHub({
  flags,
  counts,
  scopeSuffix,
  initialTool,
}: {
  flags: CrmHubFlags;
  counts: CrmHubCounts;
  scopeSuffix: string;
  /**
   * Tool to open on first render, read from `?tool=` on the server. Lets a
   * drill-down page (e.g. a company opened from the Presales tab) link back
   * to `/crm?tool=presales` and land the user on the right tab instead of
   * the bare tool picker.
   */
  initialTool?: string | null;
}) {
  const tools: TabId[] = [];
  if (flags.sales) tools.push("sales");
  if (flags.presales) tools.push("presales");
  if (flags.storage) tools.push("storage");
  if (flags.projects) tools.push("projects");
  if (flags.pricing) tools.push("pricing");

  const multiTool = tools.length > 1;
  // Single-role users land straight on their one tool; everyone else
  // starts on the tab named by `?tool=` (if valid) or the picker.
  const validInitial: TabId | null =
    initialTool && (tools as string[]).includes(initialTool)
      ? (initialTool as TabId)
      : null;
  const [tab, setTab] = useState<TabId | null>(
    tools.length === 1 ? tools[0] : validInitial,
  );

  // Restore the last-used tab on a fresh visit that didn't name a tool in
  // the URL — so a plain "CRM" breadcrumb from any deeper page (companies,
  // individuals, a project drill-down) lands back on the tab the user was
  // in, not the bare tool picker. Runs once on mount.
  useEffect(() => {
    if (tools.length <= 1 || validInitial) return;
    const saved = sessionStorage.getItem("crm.tool");
    if (saved && (tools as string[]).includes(saved)) {
      setTab(saved as TabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the active tab and keep the URL's `?tool=` in sync (without a
  // full navigation) so the breadcrumb links resolve to the same tab and
  // the browser Back button restores it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("crm.tool", tab ?? "");
    const url = new URL(window.location.href);
    if (tab) url.searchParams.set("tool", tab);
    else url.searchParams.delete("tool");
    window.history.replaceState(null, "", url);
  }, [tab]);

  const entryCards: Record<TabId, EntryCard[]> = {
    // The Sales tab is just the Quote-to-Delivery pipeline — sales drive the
    // whole quotation lifecycle (value, margin, forecast, client outcome) from
    // that one board. Opening an RFQ happens in-context from a client/project,
    // and project handoffs live in the Projects area. There is no separate
    // Approvals queue: there is no sales-manager sign-off step any more.
    sales: [
      {
        href: "/crm/pipeline",
        title: "Pipeline",
        desc: "Quote-to-delivery board: value, margin, forecast and outcomes.",
      },
    ],
    presales: [
      {
        href: "/leads",
        title: "Lead queue",
        desc: "Claim a lead and turn it into a company, client, project and quotation.",
      },
      { href: "/pricing", title: "Pricing sheets", desc: "Prepare manufacturer pricing, then convert to a quotation." },
    ],
    storage: [
      { href: "/crm/storage", title: "Storage workspace", desc: "Browse the product catalogue and manage stock." },
    ],
    projects: [
      {
        href: "/projects",
        title: "My projects",
        desc: "Projects assigned to you — execution data, notes and follow-ups.",
      },
      ...(flags.projectsManager
        ? [
            {
              href: "/projects/handoffs",
              title: "Handoffs to assign",
              desc: "Assign a technician / engineer to projects pushed from sales.",
            },
          ]
        : []),
    ],
    pricing: [
      { href: "/pricing", title: "Pricing workspaces", desc: "Per-manufacturer pricing projects and constants." },
      { href: "/pricing/compare", title: "Compare", desc: "Compare pricing across manufacturers for a project." },
    ],
  };

  if (tools.length === 0) {
    return (
      <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
        <p className="text-sm text-magic-ink/60">
          No CRM tools are assigned to your account yet. Ask an admin for a role.
        </p>
      </div>
    );
  }

  // Tool picker — only when more than one tool is available.
  if (tab === null) {
    return (
      <div>
        <p className="mb-3 text-sm font-semibold text-magic-ink/70">
          Pick a tool to get started
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((id) => {
            const Icon = TAB_META[id].icon;
            const tone = TONES[id];
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`group flex flex-col items-start rounded-2xl border border-magic-border bg-gradient-to-br ${tone.grad} to-white p-5 text-left shadow-mt-soft transition-all ${tone.border} hover:shadow-mt-lift`}
              >
                <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tone.chip}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-base font-bold text-magic-ink">
                  {TAB_META[id].label}
                </h3>
                <p className="mt-1 text-sm text-magic-ink/60">{TAB_META[id].blurb}</p>
                <span className={`mt-3 text-xs font-semibold ${tone.text}`}>Open →</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const tone = TONES[tab];

  return (
    <div className="space-y-5">
      {/* Tab strip — only meaningful when the user has more than one tool. */}
      {multiTool && (
        <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-magic-border bg-white/70 p-1.5 backdrop-blur-sm">
          <button
            onClick={() => setTab(null)}
            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-2 text-sm font-semibold text-magic-ink/60 hover:bg-magic-soft hover:text-magic-ink transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Tools
          </button>
          <span className="mx-1 h-5 w-px bg-magic-border/70" />
          {tools.map((id) => {
            const Icon = TAB_META[id].icon;
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                  active
                    ? `${TONES[id].solid} text-white shadow-sm`
                    : "text-magic-ink/70 hover:bg-magic-soft hover:text-magic-ink"
                }`}
              >
                <Icon className="h-4 w-4" />
                {TAB_META[id].label}
              </button>
            );
          })}
        </div>
      )}

      {/* Clients first — companies / individuals are the core of the
          sales / presales / projects work. The workflow tool cards below
          (New leads, Pricing sheets, …) are additional tools layered on
          top, so they render after the clients. */}
      {TOOLS_WITH_CLIENTS.has(tab) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-magic-ink/55">
              Clients
            </h2>
            <span className="h-px flex-1 bg-magic-border/70" />
          </div>
          <CrmSearch />
          <div className="grid gap-4 md:grid-cols-2">
            <KindCard
              href={`/crm/company${scopeSuffix}${
                scopeSuffix ? "&" : "?"
              }tool=${tab}`}
              title="Company"
              icon={Building2}
              tone="indigo"
              clientLabel={`${counts.companies} ${counts.companies === 1 ? "company" : "companies"} · ${counts.companyClients} client folder${counts.companyClients === 1 ? "" : "s"}`}
              quotations={counts.companyQuotations}
              showQuotations={tab !== "projects"}
              description="Business clients. Each company holds one or more contacts, each with projects + quotations."
            />
            <KindCard
              href={`/crm/individual${scopeSuffix}${
                scopeSuffix ? "&" : "?"
              }tool=${tab}`}
              title="Individual"
              icon={User}
              tone="cyan"
              clientLabel={`${counts.individuals} ${counts.individuals === 1 ? "client" : "clients"}`}
              quotations={counts.individualQuotations}
              showQuotations={tab !== "projects"}
              description="Personal / residential clients. Each row IS the client — no company layer."
            />
          </div>
        </div>
      )}

      {/* Workflow tool cards — additional tools for the role. */}
      <div className="space-y-3">
        {TOOLS_WITH_CLIENTS.has(tab) && (
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-magic-ink/55">
              Tools
            </h2>
            <span className="h-px flex-1 bg-magic-border/70" />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entryCards[tab].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={`group rounded-2xl border border-magic-border bg-white p-5 shadow-mt-soft transition-all ${tone.border} hover:shadow-mt-lift`}
            >
              <span className={`inline-block h-1.5 w-9 rounded-full ${tone.solid}`} />
              <h3 className="mt-3 text-base font-bold text-magic-ink">{c.title}</h3>
              <p className="mt-1 text-sm text-magic-ink/60">{c.desc}</p>
              <p className={`mt-3 text-xs font-semibold ${tone.text}`}>Open →</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

const KIND_TONE: Record<string, { chip: string; border: string; text: string }> = {
  indigo: { chip: "bg-indigo-100 text-indigo-600", border: "hover:border-indigo-400", text: "text-indigo-600" },
  cyan: { chip: "bg-cyan-100 text-cyan-600", border: "hover:border-cyan-400", text: "text-cyan-600" },
};

function KindCard({
  href,
  title,
  icon: Icon,
  tone,
  clientLabel,
  quotations,
  showQuotations = true,
  description,
}: {
  href: string;
  title: string;
  icon: LucideIcon;
  tone: keyof typeof KIND_TONE;
  clientLabel: string;
  quotations: number;
  /**
   * Whether to surface the quotation-count chip. Hidden on the Projects
   * tool — project managers plan execution work, so a quotations tally is
   * noise on their client cards.
   */
  showQuotations?: boolean;
  description: string;
}) {
  const t = KIND_TONE[tone];
  return (
    <Link
      href={href}
      className={`block rounded-2xl border border-magic-border bg-white p-6 shadow-mt-soft transition-all ${t.border} hover:shadow-mt-lift`}
    >
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${t.chip}`}>
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="text-xl font-bold text-magic-ink">{title}</h2>
      </div>
      <p className="mt-2 text-sm text-magic-ink/60">{description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-magic-ink/60">
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
          {clientLabel}
        </span>
        {showQuotations && (
          <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
            {quotations} quotation{quotations === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className={`mt-3 text-xs font-semibold ${t.text}`}>Drill in →</p>
    </Link>
  );
}
