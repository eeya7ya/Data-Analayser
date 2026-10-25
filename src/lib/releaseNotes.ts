/**
 * Release-notes changelog — the single source of truth for BOTH the app
 * version string (the footer + the "Product updates" badge) and the entries
 * shown in the Product-updates feed (/updates).
 *
 * CONVENTION (keep this in step with CLAUDE.md):
 *   • Every shippable change adds a new entry at the TOP of this list and bumps
 *     the version by 0.01 (e.g. 1.70 → 1.71). `APP_VERSION` is derived from the
 *     first entry, so bumping the version and recording what changed is one and
 *     the same edit — they can never drift apart.
 *   • `ensureSchema()` (src/lib/db.ts) seeds these into `news_posts` idempotently
 *     on every cold start, matched by title, so a new entry here automatically
 *     appears in everyone's Product-updates feed. No admin action needed.
 *
 * `date` is an ISO day; it drives the feed's "newest first" ordering and the
 * relative-date label, so each new entry's date must be >= the one above it.
 */
export interface ReleaseNote {
  /** Two-decimal version this note ships, e.g. "1.70". */
  version: string;
  /** ISO day (YYYY-MM-DD) the note was cut. */
  date: string;
  /** Headline shown in the feed; also the idempotency key for the seed. */
  title: string;
  /** Module audiences ("all" = everyone). */
  audience_modules: string[];
  /** Role audiences ("all" = everyone). */
  audience_roles: string[];
  /** Pin to the top of the feed with a "New" badge. */
  pinned: boolean;
  /** Body: free paragraphs, plus "- Label — detail" bullet lines. */
  body: string;
}

/** Newest first. The first entry's `version` is the current app version. */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.82",
    date: "2026-10-25",
    title: "v1.82 — Sync folder mirrors the CRM",
    audience_modules: ["all"],
    audience_roles: ["all"],
    pinned: true,
    body: [
      "The Sync folder on your computer now has the same layout as the app, so a project is easy to find.",
      "- Same layout as the app — Companies › company › person › project, plus Individual clients and Unclassified clients.",
      "- A folder for each kind — BOQs, Quotation files, PO files and Other files. Drop a file into one to upload it as that kind.",
      "- Quotations as Excel and PDF — an editable Excel, a locked (Read-only) Excel and the same read-only, watermarked PDF as PDF Full.",
      "- Fixed — the \"Name is not allowed\" error on client or project names with unusual characters.",
      "- Old folders — folders in the old layout are left as they are, and the Sync page lists them.",
    ].join("\n"),
  },
  {
    version: "1.81",
    date: "2026-10-21",
    title: "v1.81 — Read-only PDF quotations with watermark",
    audience_modules: ["all"],
    audience_roles: ["all"],
    pinned: true,
    body: [
      "Quotations sent to clients are now protected.",
      "- Read-only — PDF Full gives a copy that can be viewed and printed, but not edited or copied.",
      "- Encrypted — locked with AES-256. Add a password if you want one (optional).",
      "- Watermark — the logo, client, REF and date are stamped on every page.",
      "- Also — a Read-only PDF button on proposals, a locked Excel export, and a full-page cover in print.",
    ].join("\n"),
  },
  {
    version: "1.80",
    date: "2026-07-08",
    title: "v1.80 — New departments + groundwork",
    audience_modules: ["all"],
    audience_roles: ["all"],
    pinned: true,
    body: [
      "V1.8 opens up the org chart and lays the groundwork for a smoother sales flow. This release ships the foundation; the workspaces build on top of it over the next updates.",
      "- New departments — Delivery, Showroom and Accounting are now assignable job roles. Admins can grant them from Users & Roles today; the Delivery workspace (delivery requests from sales and from projects) and the Showroom / Accounting surfaces follow.",
      "- Coming next — one-screen lead creation for sales, cross-role file sharing (choose exactly which files presales/sales see), and a per-lead lifecycle map that time-stamps every step so delays are easy to spot.",
    ].join("\n"),
  },
  {
    version: "1.70",
    date: "2026-06-28",
    title: "v1.70 — Pipeline-first sales, cleaner quotations",
    audience_modules: ["all"],
    audience_roles: ["all"],
    pinned: true,
    body: [
      "Sales now run the whole deal from one place — the Quote-to-Delivery pipeline — and the quotation screen is no longer cluttered with controls that duplicated it.",
      "- Quote-to-Delivery pipeline — a single board tracks every deal from Quoting through Won / Held / Execution to Delivered, with a weighted revenue forecast and a next-best-action for each card.",
      "- Quotation approval bar — the old sales-manager sign-off step is gone. Presales hand a quotation to sales with 'Send to sales'; sales drive the client outcome from the pipeline.",
      "- Removed the dead 'Approvals' queue — there is no sign-off step any more, so the queue, its bell alarm and its badge (which could never clear) were retired.",
      "- Export as Excel — quotations can now be exported as a brand-matched .xlsx workbook alongside the existing PDF.",
      "- Admin overview — admins get a people-and-departments dashboard instead of the sales analytics board.",
      "- Product updates — this feed now keeps a running changelog, tailored to your role, with every release.",
    ].join("\n"),
  },
];

/** Current app version, derived from the newest release note. */
export const APP_VERSION = RELEASE_NOTES[0]?.version ?? "1.70";
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
