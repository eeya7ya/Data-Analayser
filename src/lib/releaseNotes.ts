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
