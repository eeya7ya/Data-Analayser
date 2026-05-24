"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Users,
  Briefcase,
  ClipboardList,
  Boxes,
  FolderKanban,
  Tags,
  ChevronLeft,
  type LucideIcon,
} from "lucide-react";
import CrmSearch from "@/components/CrmSearch";

/**
 * The CRM hub. On entry the user picks a tool first (Clients / Sales /
 * Presales / Storage / Projects / Pricing) — nothing drills into
 * companies or clients until a tool is chosen. Only tools the signed-in
 * user's role grants are offered, and the data behind them is always
 * scoped to the user's own people (admins can widen via the scope
 * picker on the page). Each module tool is an entry board into that
 * module rather than a duplicate of it.
 */

export interface CrmHubFlags {
  sales: boolean;
  presales: boolean;
  storage: boolean;
  projects: boolean;
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

type TabId = "clients" | "sales" | "presales" | "storage" | "projects" | "pricing";

const TAB_META: Record<TabId, { label: string; icon: LucideIcon; blurb: string }> = {
  clients: {
    label: "Clients",
    icon: Users,
    blurb: "Your companies and individual clients, with projects + quotations.",
  },
  sales: {
    label: "Sales",
    icon: Briefcase,
    blurb: "Leads, approvals, and converting won deals into projects.",
  },
  presales: {
    label: "Presales",
    icon: ClipboardList,
    blurb: "Lead inbox, the designer, and pricing → quotation.",
  },
  storage: {
    label: "Storage",
    icon: Boxes,
    blurb: "Inventory, locations, and incoming stock-check requests.",
  },
  projects: {
    label: "Projects",
    icon: FolderKanban,
    blurb: "Every project you own or are assigned to, across clients.",
  },
  pricing: {
    label: "Pricing",
    icon: Tags,
    blurb: "Per-manufacturer pricing workspaces and comparisons.",
  },
};

export default function CrmModuleHub({
  flags,
  counts,
  scopeSuffix,
}: {
  flags: CrmHubFlags;
  counts: CrmHubCounts;
  scopeSuffix: string;
}) {
  const tools: TabId[] = ["clients"];
  if (flags.sales) tools.push("sales");
  if (flags.presales) tools.push("presales");
  if (flags.storage) tools.push("storage");
  if (flags.projects) tools.push("projects");
  if (flags.pricing) tools.push("pricing");

  // Tool-first: nothing is selected until the user picks one.
  const [tab, setTab] = useState<TabId | null>(null);

  const entryCards: Record<Exclude<TabId, "clients">, EntryCard[]> = {
    // Sales is no longer tied to quotations — it lives around leads,
    // approvals, and converting won deals into projects.
    sales: [
      { href: "/leads", title: "Leads", desc: "Open and track sales leads through the pipeline." },
      { href: "/inbox/approvals", title: "Approvals", desc: "Review and sign off quotations awaiting approval." },
      { href: "/projects/handoffs", title: "Project handoffs", desc: "Quotations you converted into projects, and their status." },
    ],
    presales: [
      { href: "/leads/inbox", title: "Lead inbox", desc: "Leads routed to you for quotation design." },
      { href: "/designer", title: "Designer", desc: "Build a quotation from the catalogue or with AI." },
      { href: "/pricing", title: "Pricing sheets", desc: "Prepare manufacturer pricing, then convert to a quotation." },
    ],
    storage: [
      { href: "/storage", title: "Storage workspace", desc: "Inventory, locations, and incoming stock-check requests." },
    ],
    projects: [
      { href: "/projects", title: "Projects (flat view)", desc: "Every project you own or are assigned to, across clients." },
      { href: "/projects/handoffs", title: "Handoffs to assign", desc: "Assign a project member to converted quotations." },
    ],
    pricing: [
      { href: "/pricing", title: "Pricing workspaces", desc: "Per-manufacturer pricing projects and constants." },
      { href: "/pricing/compare", title: "Compare", desc: "Compare pricing across manufacturers for a project." },
    ],
  };

  // Tool picker — the first thing the user sees.
  if (tab === null) {
    return (
      <div>
        <p className="mb-3 text-sm font-semibold text-magic-ink/70">
          Pick a tool to get started
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((id) => {
            const Icon = TAB_META[id].icon;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="group flex flex-col items-start rounded-2xl border border-magic-border bg-white p-5 text-left shadow-mt-soft transition-all hover:border-magic-red hover:shadow-mt-lift"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-magic-red/12 to-magic-accent/10 text-magic-red">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-base font-bold text-magic-ink group-hover:text-magic-red">
                  {TAB_META[id].label}
                </h3>
                <p className="mt-1 text-sm text-magic-ink/60">{TAB_META[id].blurb}</p>
                <span className="mt-3 text-xs font-semibold text-magic-red">Open →</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Tab strip with a return-to-picker control. */}
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
                  ? "bg-gradient-to-r from-magic-red to-magic-red/85 text-white shadow-sm"
                  : "text-magic-ink/70 hover:bg-magic-soft hover:text-magic-ink"
              }`}
            >
              <Icon className="h-4 w-4" />
              {TAB_META[id].label}
            </button>
          );
        })}
      </div>

      {tab === "clients" ? (
        <div className="space-y-4">
          <CrmSearch />
          <div className="grid gap-4 md:grid-cols-2">
            <KindCard
              href={`/crm/company${scopeSuffix}`}
              title="Company"
              clientLabel={`${counts.companies} ${counts.companies === 1 ? "company" : "companies"} · ${counts.companyClients} client folder${counts.companyClients === 1 ? "" : "s"}`}
              quotations={counts.companyQuotations}
              description="Business clients. Each company holds one or more contacts, each with projects + quotations."
            />
            <KindCard
              href={`/crm/individual${scopeSuffix}`}
              title="Individual"
              clientLabel={`${counts.individuals} ${counts.individuals === 1 ? "client" : "clients"}`}
              quotations={counts.individualQuotations}
              description="Personal / residential clients. Each row IS the client — no company layer."
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entryCards[tab].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group rounded-2xl border border-magic-border bg-white p-5 shadow-mt-soft transition-all hover:border-magic-red hover:shadow-mt-lift"
            >
              <h3 className="text-base font-bold text-magic-ink group-hover:text-magic-red">
                {c.title}
              </h3>
              <p className="mt-1 text-sm text-magic-ink/60">{c.desc}</p>
              <p className="mt-3 text-xs font-semibold text-magic-red">Open →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function KindCard({
  href,
  title,
  clientLabel,
  quotations,
  description,
}: {
  href: string;
  title: string;
  clientLabel: string;
  quotations: number;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-magic-border bg-white p-6 shadow-mt-soft transition-all hover:border-magic-red hover:shadow-mt-lift"
    >
      <h2 className="text-xl font-bold text-magic-ink">{title}</h2>
      <p className="mt-1 text-sm text-magic-ink/60">{description}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-magic-ink/60">
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
          {clientLabel}
        </span>
        <span className="inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 font-semibold">
          {quotations} quotation{quotations === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold text-magic-red">Drill in →</p>
    </Link>
  );
}
