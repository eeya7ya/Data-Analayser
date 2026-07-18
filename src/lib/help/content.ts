/**
 * In-app help content — the single source of truth for both the inline
 * "wondermark" tips (<HelpTip/>) and the role-aware Help Center drawer
 * (<HelpCenter/>).
 *
 * Two kinds of content live here:
 *
 *   1. HELP_TIPS  — short, area-scoped explanations keyed by a stable id.
 *      An inline <HelpTip id="..."/> renders the little ⍰ marker and pops
 *      the matching entry. Placing a tip anywhere in the app is therefore
 *      a one-liner that references an id defined here, so the copy stays
 *      centralized and consistent.
 *
 *   2. HELP_DOCS  — the longer, walk-through documentation shown in the
 *      Help Center. Every doc declares an `audience`; the Center only
 *      shows a doc when the signed-in user actually holds a matching
 *      module role, so each person reads documentation for THEIR job and
 *      nothing else. Admins (and legacy users with no grants yet, who can
 *      reach every module) see everything.
 *
 * This file is plain data + pure helpers so it is safe to import from
 * client components. Icons are stored as string names and resolved to
 * lucide components in the UI layer.
 */

/** A single (module, role) grant, mirrored from /api/auth/me. */
export interface Grant {
  module: string;
  role: string;
}

/** One inline tip: a title and a short body shown in the popover. */
export interface HelpTipContent {
  title: string;
  body: string;
}

/**
 * Inline tips, keyed by a stable dotted id (area.subject). Keep bodies to
 * one or two sentences — the popover is a nudge, the Help Center carries
 * the depth.
 */
export const HELP_TIPS: Record<string, HelpTipContent> = {
  // ── Dashboard ──────────────────────────────────────────────────────────
  "dashboard.kpis": {
    title: "Your headline numbers",
    body: "A live count of the records you own — quotations, clients, companies and projects. Salespeople see 'Deals won' here instead, because they close deals rather than author quotations.",
  },
  "dashboard.trend": {
    title: "Activity over time",
    body: "How much you've created recently. Toggle Daily / Weekly / Monthly to zoom in or out. Presales see quotations created; sales see the deals they've won.",
  },
  "dashboard.outcomes": {
    title: "Won · Lost · Held",
    body: "Your sales scoreboard. Won counts accepted or transferred deals, Lost counts rejected ones, and Held are deals paused for later.",
  },
  "dashboard.status": {
    title: "Quotation status mix",
    body: "A breakdown of your quotations by their current stage, so you can see where work is piling up.",
  },
  "dashboard.messages": {
    title: "Messages & alarms",
    body: "Your personal inbox for hand-offs, approvals and reminders. Opening an item takes you straight to the record it's about.",
  },

  // ── CRM hub ────────────────────────────────────────────────────────────
  "crm.tools": {
    title: "Your tools",
    body: "Each tool is a role workflow — Sales, Presales, Storage, Projects, Pricing or Executive. If you only hold one role you land on it directly; with several you pick here and can switch tabs any time.",
  },
  "crm.clients": {
    title: "Companies vs Individuals",
    body: "A Company holds one or more contacts, each with their own projects and quotations. An Individual IS the client — no company layer. Pick the kind that matches who you're selling to.",
  },
  "crm.pipeline": {
    title: "Quote-to-delivery pipeline",
    body: "The board that tracks every open deal from quotation through to delivery — value, margin, forecast and outcome — so nothing stalls unnoticed.",
  },
  "crm.received": {
    title: "Received quotations",
    body: "Quotations presales prepared and sent to you. File each one under the right client and project, then drive it with the customer.",
  },
  "crm.leadQueue": {
    title: "Shared lead queue",
    body: "New leads waiting for an owner. Claim one to turn it into a company, client, project and quotation. Once claimed it's yours to work.",
  },
  "crm.pricingAccess": {
    title: "Pricing access",
    body: "As presales manager you decide which presales members can open the Pricing module. Grant it per person here.",
  },

  // ── Quotation authoring ─────────────────────────────────────────────────
  "quote.designer": {
    title: "Quotation Designer",
    body: "Where presales build a priced quotation line by line. Sales can view, print, convert and request changes, but only presales and admins may edit.",
  },
  "quote.submitExecutive": {
    title: "Submit for confirmation",
    body: "Send a finished quotation or pricing sheet to the executive manager, who confirms or rejects it before it goes out.",
  },

  // ── Projects ────────────────────────────────────────────────────────────
  "projects.handoffs": {
    title: "Handoffs to assign",
    body: "Projects pushed from sales that still need a technician or engineer. As project manager, assign the right person to each one.",
  },
  "projects.schedule": {
    title: "Day schedule",
    body: "Your execution work laid out by day, so field teams know what's on and managers can balance the load.",
  },
  "projects.reports": {
    title: "Execution reports",
    body: "Log progress on a project as you work — updates, a percentage complete, or a 'done' mark. These feed the completion bars managers watch.",
  },

  // ── Storage ─────────────────────────────────────────────────────────────
  "storage.stockChecks": {
    title: "Stock checks",
    body: "Availability questions raised against a quotation. Answer each pending check so sales know what's in stock before promising a date.",
  },
  "storage.catalogue": {
    title: "Product catalogue",
    body: "The master list of products and systems. Keep it accurate — every quotation and pricing sheet draws from it.",
  },

  // ── Pricing ─────────────────────────────────────────────────────────────
  "pricing.workspace": {
    title: "Manufacturer workspaces",
    body: "A pricing project per manufacturer. Build the sheet with the right constants and margins, then convert it into a quotation.",
  },
  "pricing.compare": {
    title: "Compare manufacturers",
    body: "Put manufacturers side by side for the same project to pick the best price before you quote.",
  },

  // ── Admin ───────────────────────────────────────────────────────────────
  "admin.roles": {
    title: "Users & roles",
    body: "Assign each person the module roles their job needs. Roles decide which tools, tabs and actions they see — grants are never deleted, only revoked, so history is preserved.",
  },
};

// ── Help Center documents ─────────────────────────────────────────────────

export interface HelpDocSection {
  heading: string;
  body: string;
  /** Optional ordered walk-through shown as numbered steps. */
  steps?: string[];
}

export interface HelpDoc {
  id: string;
  title: string;
  /** lucide icon name, resolved in the UI. */
  icon: string;
  /** tone key → colour classes, resolved in the UI. */
  tone: string;
  intro: string;
  sections: HelpDocSection[];
  /**
   * Who this doc is for. `undefined` means "general" (everyone). Otherwise
   * the doc shows when the user holds ANY listed (module + role) grant; omit
   * `roles` to match any role within the module.
   */
  audience?: Array<{ module: string; roles?: string[] }>;
}

export const HELP_DOCS: HelpDoc[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: "Compass",
    tone: "red",
    intro:
      "The essentials that work the same for everyone, whatever your role.",
    sections: [
      {
        heading: "Finding your way around",
        body: "The top bar is your anchor on every page. Use it to move around and to get help.",
        steps: [
          "Tap the Menu button (top-left) to open the navigation drawer with every area you can reach.",
          "Use Back to return to the previous page — it never dead-ends, it falls back to the Dashboard.",
          "The bell shows notifications: hand-offs, approvals and reminders aimed at you.",
          "Tap Help (the ⍰ on the top bar) any time to reopen this guide.",
        ],
      },
      {
        heading: "The little ⍰ markers",
        body: "Wherever a screen might be unclear you'll see a small ⍰ marker next to a heading or control. Tap it for a quick explanation of exactly that area — no need to leave the page.",
      },
      {
        heading: "Your dashboard",
        body: "The home screen is tailored to your role — sales see deals, presales see quotations, project teams see execution work, storage sees stock checks, and admins see people and departments. The numbers are live, so they update as you and your team work.",
      },
    ],
  },
  {
    id: "personal-tools",
    title: "Personal tools",
    icon: "NotebookPen",
    tone: "accent",
    intro:
      "Tools every signed-in user has, each with its own private data.",
    sections: [
      {
        heading: "Calendar",
        body: "A shared calendar for scheduling and marking key dates. Reach it from the navigation drawer.",
      },
      {
        heading: "Email",
        body: "Send and read mail without leaving the app, so client correspondence stays next to the work it relates to.",
      },
      {
        heading: "My Notes",
        body: "A private scratchpad only you can see — jot reminders, client details or anything you want to keep to hand.",
      },
      {
        heading: "Sync folder & Updates",
        body: "Sync folder keeps your files in step across sessions. Updates is the changelog — check it to see what's new in the app.",
      },
    ],
  },
  {
    id: "sales",
    title: "Sales",
    icon: "Briefcase",
    tone: "indigo",
    audience: [{ module: "crm", roles: ["sales", "sales_manager"] }],
    intro:
      "Own your clients and drive every deal from quotation to a closed outcome.",
    sections: [
      {
        heading: "The pipeline board",
        body: "Your quote-to-delivery board tracks every open deal — value, margin, forecast and outcome — in one place so nothing stalls.",
        steps: [
          "Open CRM → Sales → Pipeline.",
          "Work each deal down the stages as it progresses with the customer.",
          "Record the outcome — Won, Lost or Held — so your scoreboard and forecast stay accurate.",
        ],
      },
      {
        heading: "Requesting a quotation",
        body: "You sell; presales price. When a client needs a quotation, raise a Request for Quotation from the client or project and presales will pick it up, prepare it, and send it back to you.",
      },
      {
        heading: "Received quotations",
        body: "Quotations presales prepared for you land under CRM → Sales → Received. File each under the right client and project, then present it, print it, or request changes.",
      },
      {
        heading: "Won, Lost & Held",
        body: "Recording an outcome is what moves a deal off the board and feeds your dashboard scoreboard. Held pauses a deal for later without losing it.",
      },
    ],
  },
  {
    id: "presales",
    title: "Presales",
    icon: "ClipboardList",
    tone: "cyan",
    audience: [{ module: "crm", roles: ["presales", "presales_manager"] }],
    intro:
      "Turn leads into priced, ready-to-send quotations for the sales team.",
    sections: [
      {
        heading: "The lead queue",
        body: "New leads arrive in a shared queue. Claiming one makes it yours to build out.",
        steps: [
          "Open CRM → Presales → Lead queue.",
          "Claim a lead to take ownership.",
          "Turn it into a company (or individual), a project, and a quotation.",
        ],
      },
      {
        heading: "Authoring a quotation",
        body: "Build priced quotations in the Designer, the AI Designer, or from the Catalogue. Only presales and admins may author and price — sales can view but not edit.",
      },
      {
        heading: "Pricing sheets",
        body: "If you have pricing access, prepare a manufacturer pricing sheet and convert it straight into a quotation. Your presales manager grants pricing access per person.",
      },
      {
        heading: "Submitting for executive sign-off",
        body: "Finished quotations and pricing sheets go to the executive manager for confirmation before they're final. Submit from the record and watch for the confirm / reject result.",
      },
      {
        heading: "For presales managers",
        body: "You lead the pricing lifecycle and delegate access. Use CRM → Presales → Pricing access to choose which members can open the Pricing module.",
      },
    ],
  },
  {
    id: "executive",
    title: "Executive sign-off",
    icon: "BadgeCheck",
    tone: "rose",
    audience: [{ module: "crm", roles: ["executive_manager"] }],
    intro:
      "Confirm or reject the quotations and pricing sheets presales prepare.",
    sections: [
      {
        heading: "The confirmations queue",
        body: "Everything presales submits for sign-off collects in one queue for your decision.",
        steps: [
          "Open CRM → Executive → Confirmations.",
          "Review each submitted quotation or pricing sheet.",
          "Confirm to release it, or reject with a reason so presales can revise.",
        ],
      },
    ],
  },
  {
    id: "pricing",
    title: "Pricing",
    icon: "Tags",
    tone: "emerald",
    audience: [
      { module: "pricing" },
      { module: "crm", roles: ["presales_manager"] },
    ],
    intro:
      "Build per-manufacturer pricing and turn the best option into a quotation.",
    sections: [
      {
        heading: "Manufacturer workspaces",
        body: "Each manufacturer gets its own pricing project. Set the constants and margins, price the items, then convert the sheet into a quotation.",
      },
      {
        heading: "Comparing manufacturers",
        body: "Use Pricing → Compare to put manufacturers side by side for the same project, so you quote the best price with confidence.",
      },
      {
        heading: "Trash & revisions",
        body: "Nothing is lost for good — deleted pricing projects and manufacturers move to Trash, and projects keep a revision history you can revisit.",
      },
    ],
  },
  {
    id: "projects",
    title: "Projects & execution",
    icon: "FolderKanban",
    tone: "violet",
    audience: [{ module: "projects" }],
    intro:
      "Deliver the work — your assignments, your schedule, and progress reporting.",
    sections: [
      {
        heading: "My projects",
        body: "Projects assigned to you, with their execution data, notes and follow-ups. Open CRM → Projects → My projects.",
      },
      {
        heading: "Day schedule",
        body: "Your execution work laid out by day so you know what's on. Managers use it to balance the team's load.",
      },
      {
        heading: "Reporting progress",
        body: "Keep a project's completion honest by logging execution reports — a note, a percentage, or a 'done' mark. These drive the completion bars everyone watches.",
      },
      {
        heading: "For project managers",
        body: "You assign work and design the templates it runs on.",
        steps: [
          "Handoffs to assign: give each project pushed from sales a technician or engineer.",
          "Checklist Designer: build master job checklists that seed a project when it's distributed.",
          "Distribution: push execution work out to the right members.",
        ],
      },
    ],
  },
  {
    id: "storage",
    title: "Storage",
    icon: "Boxes",
    tone: "amber",
    audience: [{ module: "storage" }],
    intro:
      "Keep the catalogue and stock accurate, and answer availability questions.",
    sections: [
      {
        heading: "Stock checks",
        body: "When sales need to know what's available, a stock check is raised against a quotation. Answer each pending check so promises match reality.",
        steps: [
          "Open the Storage workspace from CRM → Storage.",
          "Work the pending stock checks — each lists the items in question.",
          "Answer availability so the deal can move forward.",
        ],
      },
      {
        heading: "The product catalogue",
        body: "The master list of products and systems every quotation draws from. Keep entries and stock levels current.",
      },
      {
        heading: "Locations & events",
        body: "Stock is event-sourced: movements are recorded as events across locations, so the current level is always traceable to how it got there.",
      },
    ],
  },
  {
    id: "delivery",
    title: "Delivery",
    icon: "Truck",
    tone: "amber",
    audience: [{ module: "delivery" }],
    intro:
      "Fulfil delivery requests routed from sales and from projects.",
    sections: [
      {
        heading: "The delivery queue",
        body: "Delivery requests collect in one queue. Open Delivery from the navigation drawer to see what's waiting.",
      },
      {
        heading: "Drivers vs managers",
        body: "Drivers do the runs and mark them complete. Managers dispatch and triage the queue, assigning runs to drivers.",
      },
    ],
  },
  {
    id: "admin",
    title: "Administration",
    icon: "ShieldCheck",
    tone: "ink",
    audience: [{ module: "admin" }],
    intro:
      "Manage people, roles, departments and the platform itself.",
    sections: [
      {
        heading: "Users & roles",
        body: "The heart of access control. Give each person the module roles their job needs — roles decide which tools, tabs and actions they see.",
        steps: [
          "Open the Admin console from the navigation drawer.",
          "Assign module roles per person (a user can hold several).",
          "Revoke a role to remove access — grants are never deleted, only revoked, so the history stays intact.",
        ],
      },
      {
        heading: "Departments & branding",
        body: "Organise users into departments and tune the app's branding and news bar from the admin console.",
      },
      {
        heading: "Email, backups & health",
        body: "Configure email accounts, run and restore database / file backups, and watch the system log and database health from one place.",
      },
      {
        heading: "Installation rates & catalogue",
        body: "Maintain the installation-rate constants used by the calculator, and modify the shared product catalogue.",
      },
    ],
  },
];

/**
 * Does this doc apply to the given user? General docs (no audience) always
 * match. Admins and users with no grants yet — who reach every module via the
 * legacy bypass — see everything. Otherwise a doc matches when the user holds
 * any of its audience grants.
 */
export function docMatchesUser(
  doc: HelpDoc,
  opts: { isAdmin: boolean; grants: Grant[] },
): boolean {
  if (!doc.audience) return true;
  if (opts.isAdmin) return true;
  // A user with no module grants can currently reach every module (the V2
  // legacy bypass), so show them all documentation rather than hiding it.
  if (opts.grants.length === 0) return true;
  return doc.audience.some((a) =>
    opts.grants.some(
      (g) => g.module === a.module && (!a.roles || a.roles.includes(g.role)),
    ),
  );
}

/** The docs visible to a user, in registry order. */
export function docsForUser(opts: {
  isAdmin: boolean;
  grants: Grant[];
}): HelpDoc[] {
  return HELP_DOCS.filter((d) => docMatchesUser(d, opts));
}
