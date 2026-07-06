import postgres, { type Sql } from "postgres";
import { RELEASE_NOTES } from "./releaseNotes";
import { getD1Sql } from "./db-d1-sql";
import { isD1Configured, d1Query } from "./db-d1";
import { applyD1Schema } from "./d1-schema";
import { D1_SCHEMA_SQL } from "./d1Schema.generated";
import { ensureD1Fts } from "./fts";

/**
 * Postgres client for Vercel serverless runtimes.
 *
 * The connection URL should point at a **transaction pooler** (e.g. port
 * `6543`) — e.g.:
 *
 *   postgres://<user>:<password>@<host>:6543/<database>
 *
 * Transaction mode is required for serverless because each function
 * invocation briefly checks out a pooled connection. This mode does NOT
 * support server-side prepared statements, so `prepare: false` is mandatory.
 *
 * Env var resolution order (first non-empty wins):
 *   1. DATABASE_URL            — manual setup (our docs).
 *   2. POSTGRES_URL            — common alias (also injected by some Vercel
 *                                Postgres integrations); pooled endpoint.
 *   3. POSTGRES_PRISMA_URL     — same source, Prisma-flavoured pooled URL.
 *   4. POSTGRES_URL_NON_POOLING — last-resort direct connection (NOT
 *                                 recommended for serverless — see note).
 *
 * The client is memoised on the module scope so hot-invoked lambdas reuse
 * the same socket between requests, and `max: 1` keeps the Vercel function's
 * pool footprint tiny.
 */

// Re-use the client across warm invocations of the same serverless instance.
// `globalThis` so hot-reload in `next dev` doesn't leak sockets.
const globalForDb = globalThis as unknown as {
  __mtSql?: Sql;
};

/** True when any Postgres connection string is configured. */
function hasPostgresUrl(): boolean {
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING,
  );
}

function getUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    throw new Error(
      "No Postgres connection string found. Expected one of DATABASE_URL, " +
        "POSTGRES_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL_NON_POOLING in " +
        "your host's environment variables (e.g. Vercel → Project Settings → " +
        "Environment Variables); redeploy after setting it.",
    );
  }
  return url;
}

/**
 * Returns a lazily-created, process-wide `postgres` tagged-template client.
 * Usage:
 *   const q = sql();
 *   const rows = await q`select * from users where id = ${id}`;
 */
/**
 * Whether the app talks to Cloudflare D1 (the default) rather than Postgres.
 *
 * D1 is now the app's primary database. Postgres/Neon has been retired, so the
 * app runs with no Postgres connection string configured at all. Setting
 * `USE_D1=0` opts back into the (dormant) Postgres path — kept only as an
 * emergency fallback for anyone who still has a Postgres URL.
 */
export function usingD1(): boolean {
  // Explicit override wins either way.
  if (process.env.USE_D1 === "0") return false;
  if (process.env.USE_D1 === "1") return true;
  // Unset (the normal case): use D1 when it's configured.
  if (isD1Configured()) return true;
  // D1 not configured: only fall back to Postgres if a Postgres URL actually
  // exists (a not-yet-migrated environment). With Postgres removed too, stay on
  // D1 so the error points at the D1 setup — the intended database — instead of
  // a misleading "no Postgres connection string".
  return !hasPostgresUrl();
}

export function sql(): Sql {
  // D1 is the default database: route every query through the D1 engine
  // (src/lib/db-d1-sql.ts) instead of Postgres. Only `USE_D1=0` falls back to
  // the legacy Postgres client (which then needs a connection string).
  if (usingD1()) {
    return getD1Sql() as unknown as Sql;
  }
  if (!globalForDb.__mtSql) {
    globalForDb.__mtSql = postgres(getUrl(), {
      // The pooler requires TLS for every connection.
      ssl: "require",
      // Required for transaction-mode poolers (pgbouncer-in-transaction-mode)
      // because prepared statements cannot span pooled connections.
      prepare: false,
      // Small pool per lambda — three sockets is the sweet spot for the CRM
      // fan-out queries (dashboard summary, list+count pairs) where
      // Promise.all only helps if there are multiple connections to dispatch
      // across. Previously `max: 1` serialised those queries and was a major
      // cause of the "dashboard times out" symptom. Three is still tiny
      // enough that 100 concurrent warm lambdas stay well under the
      // Supavisor client budget.
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      // Let transient network hiccups retry instead of failing the request.
      max_lifetime: 60 * 30,
      // Suppress NOTICE noise in production logs.
      onnotice: () => {},
    });
  }
  return globalForDb.__mtSql;
}

/**
 * Backend-aware positional-parameter binder for raw `q.unsafe(text, params)`
 * queries. SQLite/D1 uses `?` placeholders; Postgres uses `$1, $2, …`. Call
 * `P(value)` once per bound value, in the order the placeholders appear in the
 * SQL — it records the value and returns the correct placeholder token for the
 * active backend:
 *
 *   const { P, params } = rawBinder();
 *   const rows = await q.unsafe(
 *     `select * from t where owner_id = ${P(ownerId)} and name ilike ${P(like)}`,
 *     params,
 *   );
 *
 * This lets the search builders assemble raw SQL (needed because the D1 client's
 * tagged template returns a Promise, not a composable fragment) while still
 * running on either backend.
 */
export function rawBinder(): {
  P: (value: string | number | null) => string;
  params: Array<string | number | null>;
} {
  const d1 = usingD1();
  const params: Array<string | number | null> = [];
  const P = (value: string | number | null): string => {
    params.push(value);
    return d1 ? "?" : `$${params.length}`;
  };
  return { P, params };
}

// ── Schema initialisation guard ────────────────────────────────────────────
// Ensures the DDL block runs at most once per process lifetime.  Concurrent
// callers (typical on Vercel cold-start) all await the same promise instead
// of racing through CREATE / ALTER statements on a single-connection pool.
const globalForSchema = globalThis as unknown as {
  __mtSchemaPromise?: Promise<void>;
};

/**
 * Schema fingerprint. Bump this string any time `_ensureSchemaOnce` gains
 * new DDL that must run against existing databases — it's the key we store
 * in `migration_flags` to short-circuit the bootstrap on warm deployments.
 *
 * The full DDL block is ~35 sequential statements and each one is a
 * database round-trip. Running them on every Vercel cold start was adding
 * 2-3 seconds of pure wait time to every request that landed on a new
 * serverless instance, which is what drove the "every page takes way too
 * long to open" complaint. With the fingerprint marker we turn the
 * bootstrap into a single `select 1` on warm databases.
 */
const SCHEMA_FINGERPRINT = "schema_bootstrap_v2_2026_04";

/**
 * Incremental migration: composite indexes for the two most common list
 * queries. Both filter on (owner_id, deleted_at) but previously only had
 * single-column indexes, forcing Postgres to intersect two bitmap scans.
 * The composite index lets it satisfy the full WHERE clause in one pass.
 */
const PERF_INDEX_FLAG = "perf_composite_indexes_v1_2026_04";

/**
 * Incremental migration: adds `status` ('active' | 'draft' | 'review') and
 * `parent_ref` columns to `quotations` so the Designer can mint "Save as
 * Draft" / "Save as Review" snapshots of an existing quotation. The REF
 * generator in `src/app/api/quotations/route.ts` uses these to build the
 * smart ref format
 *
 *   Q<L><MDDYY>MT<n>[R<m> | D<m>]
 *
 * where L is the owner's first-letter initial, <MDDYY> is the creation
 * date (month unpadded, day zero-padded, two-digit year — e.g. April 22,
 * 2026 → "42226"), n is a GLOBAL incremental counter that reuses numbers
 * freed by soft-deleted quotations, and m is the per-parent counter of
 * reviews/drafts anchored to that original record.
 */
const QUOTATION_STATUS_FLAG = "quotation_status_v1_2026_04";

/**
 * Incremental migration: CRM foundation — adds the `activity_log` table that
 * powers the audit trail / timeline used by later CRM surfaces, plus
 * `custom_fields` JSONB columns on `quotations` and `client_folders` so ad-hoc
 * CRM metadata can be attached without further schema churn. Purely additive —
 * legacy readers never select these columns and are unaffected.
 */
const CRM_FOUNDATION_FLAG = "crm_foundation_v1_2026_04";

/**
 * CRM Phase 1: contacts + companies. People and accounts attach via nullable
 * FKs to client_folders so the existing folder UX is untouched. Phase 2 adds
 * pipelines + deals + stages keyed off these.
 */
const CRM_CONTACTS_FLAG = "crm_contacts_v1_2026_04";

/**
 * CRM Phase 2: pipelines + stages + deals. Each pipeline ships with a default
 * stage set on first creation; deals link optionally to a quotation so the
 * quotation flow is unaffected.
 */
const CRM_DEALS_FLAG = "crm_deals_v1_2026_04";

/**
 * CRM Phase 3: tasks, notes, in-app notifications. Polled by the client every
 * ~30s; no email provider involved.
 */
const CRM_TASKS_FLAG = "crm_tasks_v1_2026_04";

/**
 * CRM Phase 5: workflow rules + run history (cron-driven).
 */
const CRM_WORKFLOWS_FLAG = "crm_workflows_v1_2026_04";

/**
 * CRM Phase 6: teams, team_members, entity ACLs. Owner-isolation is the floor;
 * ACLs only grant additional access.
 */
const CRM_TEAMS_FLAG = "crm_teams_v1_2026_04";

/**
 * CRM Phase 7: Postgres full-text search across CRM entities + quotations.
 */
const CRM_SEARCH_FLAG = "crm_search_v1_2026_04";

/**
 * Performance migration v2 — hot-path composite indexes that only became a
 * bottleneck once the CRM surface started issuing dashboard aggregations
 * and filtered list queries at high fan-out. Each index below targets a
 * specific query plan that was doing a bitmap intersect or a seq-scan+filter
 * under load. Guarded by its own flag so it runs exactly once per database.
 */
const PERF_INDEX_V2_FLAG = "perf_composite_indexes_v2_2026_04";

/**
 * Quotation→contact link. Adds a nullable `contact_id` FK on `quotations` so
 * a quotation can be attributed to a specific person at the client company,
 * not just to the client folder. The CompanyDetail page uses this to group
 * each contact's own quotations underneath their card.
 */
const QUOTATION_CONTACT_FLAG = "crm_quotation_contact_v1_2026_04";

/**
 * Per-user phone number. Before this migration every non-admin quotation
 * stamped the admin's hardcoded phone under "Presales Engineer" because
 * the sales_phone field had a module-level fallback. Each user now gets
 * their own column so the quotation header prints the salesperson's
 * actual number.
 */
const USER_PHONE_FLAG = "user_phone_v1_2026_04";

/**
 * Purchase orders. Each PO is attached to a quotation (nullable so an
 * ad-hoc PO is still expressible) and owned by the user who created it.
 * Purely additive — existing quotation / folder flows are untouched.
 */
const PURCHASE_ORDERS_FLAG = "purchase_orders_v1_2026_04";

/**
 * Catalogue picture column. Adds a nullable `picture_url` text column on
 * `products` so admins can attach a small product thumbnail (stored as a
 * base64 data URL, capped client-side at ~200 KB after the existing
 * `compressDataUrl` pass). Purely additive — every legacy reader, the
 * Excel upload path, and the catalogue search predicate are all untouched
 * by the new column.
 */
const CATALOGUE_PICTURE_FLAG = "catalogue_picture_v1_2026_04";

/**
 * Projects layer. Inserts an intermediate "project" entity between
 * client folders and the things filed under them (quotations, POs and
 * uploaded files). The migration:
 *
 *   1. Creates a `projects` table (id, folder_id, owner_id, name, …)
 *      with soft-delete and the same owner-isolation contract used by
 *      every other CRM table.
 *   2. Adds a nullable `project_id` FK to `quotations` and
 *      `purchase_orders`. Nullable so legacy readers that don't filter
 *      by project still see every row.
 *   3. Creates `project_files` for arbitrary uploads (PDFs / sheets)
 *      whose binary lives in object storage (R2); this table only stores
 *      the filename, mime, byte size and the storage path.
 *   4. Backfills: for every client_folders row that doesn't already
 *      have a project, creates a "Default Project" and assigns every
 *      pre-existing quotation / purchase_order under that folder to it.
 *      No quotation column other than the new `project_id` is mutated.
 *
 * The whole migration is guarded by its own flag so it runs exactly
 * once per database, regardless of which deploy first triggers it.
 */
const PROJECTS_FOUNDATION_FLAG = "projects_foundation_v1_2026_04";

/**
 * V2.0 module RBAC + Phase 1 schema. Strictly additive — nothing is dropped,
 * renamed, or hard-deleted. Re-runs the idempotent Default-Project backfill
 * to catch any client_folders / quotations created after the original
 * projects_foundation flag fired (25 folders + 29 quotations on live as of
 * 2026-05-14). Non-admin users are NOT auto-granted module roles; they
 * surface in an admin "needs role assignment" queue and keep their current
 * legacy `users.role` access in the meantime.
 */
const MODULE_RBAC_V1_FLAG = "crm_v2_module_rbac_v1_2026_05";

/**
 * V2.0 Phase 2 — soft-revoke for user_module_roles. We never DELETE a role
 * grant; revocation flips `revoked_at` so the audit trail of "who had what
 * when" is permanent. Active grants are filtered with `revoked_at IS NULL`.
 */
const MODULE_RBAC_REVOKE_FLAG = "crm_v2_module_rbac_revoke_v1_2026_05";

/**
 * Lead lifecycle workflow. End-to-end pipeline that sits BEFORE the
 * existing quotation/folder/project surfaces:
 *
 *   new  → assigned  → in_progress  → quotation_sent
 *        → won → boq_in_progress → sent_to_execution → completed
 *        → lost (terminal)
 *
 * Anybody with a CRM role (sales / sales_manager / presales /
 * presales_manager) can OPEN a lead. The presales_manager triages the
 * queue and routes each lead to a specific presales user. That presales
 * user attaches a company / client folder / contact / quotation as the
 * deal develops, then submits the quotation back to sales. Sales marks
 * Won or Lost. On Win, the presales user uploads the BOQ, and the
 * presales_manager picks which projects-module user receives it for
 * execution.
 *
 * `lead_messages` is the local "email" channel — every transition drops
 * a row here addressed to the next responsible user, and a paired
 * `notifications` row pings the TopBar bell. The table carries the
 * `external_message_id` / `delivered_at` columns so a real SMTP / API
 * provider (Resend / SendGrid) can be wired in later without another
 * migration; the same `users.email` column ships now for the same
 * reason.
 */
const LEAD_LIFECYCLE_FLAG = "lead_lifecycle_v1_2026_05";
// quotation_stock_checks was added inside the MODULE_RBAC_V1 block but some
// databases applied that flag before the table block existed, leaving the
// table missing on production. /api/notifications hits it on every poll,
// so the bell 500s until it's re-created. This standalone flag re-runs
// only the table + index DDL.
const STOCK_CHECKS_FLAG = "quotation_stock_checks_v1_2026_05";

/**
 * Pricing module — embeds the Pricing Sheet workspace inside the host so
 * sales/presales staff can prepare manufacturer-scoped pricing projects
 * and convert any of them straight into a quotation draft. Tables are
 * prefixed `pricing_` to avoid name collisions with the host's existing
 * `projects` / `manufacturers` semantics.
 *
 * The CHECK constraint on `user_module_roles.module` also has to grow to
 * accept the new value, so this flag wraps the constraint ALTER as well —
 * the inline CREATE TABLE above already lists 'pricing' for fresh DBs.
 */
const PRICING_FOUNDATION_FLAG = "pricing_foundation_v1_2026_05";

/**
 * V1.3a — per-user notification state. The TopBar bell + the dashboard
 * Messages/Alarms panel surface a mix of derived alarms (pending
 * approvals, stock checks, unclassified folders) and admin announcements
 * (news_posts). Those sources are computed, so "mark as read" / "remove"
 * needs somewhere durable to record the user's intent. One row per
 * (user, notif_key) carries the latest status; removed items are
 * filtered out of the feed, read items render dimmed.
 */
const NOTIFICATION_STATE_FLAG = "notification_state_v1_2026_05";

/**
 * V1.3a — Convert-to-Project handoffs. A salesperson turns an approved
 * quotation into an execution handoff: the quotation's line items are
 * snapshotted as a BOQ, the client contacts + a map location + priority
 * / notes are captured, and the record routes to a projects manager to
 * assign a project member. Reuses the existing `project_assignments`
 * table for the actual roster entry on assignment.
 */
const PROJECT_HANDOFFS_FLAG = "project_handoffs_v1_2026_05";

/**
 * V1.3b — PWA push, sales change-requests, and project file sharing.
 *
 *   • `push_subscriptions` — one row per installed browser/device push
 *     endpoint so the server can deliver Web Push notifications (handoffs,
 *     approvals, messages) even when the app is closed.
 *   • `quotation_change_requests` — a salesperson can no longer edit a
 *     quotation received from presales; they file a change request that
 *     routes back to the quotation's author instead.
 *   • `project_files.shared_to_projects` — sales / presales flip this on a
 *     file so projects-module users who aren't the owner can read the BOQ
 *     / allowed attachment. Default false keeps everything private until
 *     explicitly shared.
 */
const V13B_FLAG = "v1_3b_pwa_sharing_change_requests_2026_05";

/**
 * V1.3c — execution reports. Project technicians / engineers post
 * progress updates and feedback against the project they were assigned;
 * the project manager (and project owner / admin) read them. Net-new
 * table, strictly additive.
 */
const V13C_FLAG = "v1_3c_execution_reports_2026_05";

/**
 * V1.3D — sales module. A salesperson can now mark the client outcome on
 * an approved quotation: Accepted (won), Rejected (lost), or Held for
 * Execution. A held quotation can carry a `hold_transfer_at` schedule —
 * when that time passes a lazy sweep (src/lib/holds.ts, run from the
 * pipeline list + dashboard) auto-creates the project handoff; sales can
 * also transfer it manually at any time. `transferred_at` records when
 * the held quote was actually pushed to the projects team. The Held /
 * Won / Lost buckets that power the new CRM sales-pipeline tabs and the
 * dashboard outcome stats are derived from these columns. Also seeds a
 * pinned "update notes" post so the new CRM Update Notes panel isn't
 * empty on first load. Strictly additive.
 */
// Bumped to _v2 for 1.4C/1.4D: the presales→sales handoff columns
// (sent_to_sales_at/by, sales_accepted_at/by) live inside this block, so the
// flag value must change to force the (idempotent) block to re-run once on
// databases that already had the original v1.3D migration applied. Without
// the bump those columns never get created and /send-to-sales 500s.
const V13D_FLAG = "v1_3d_sales_module_2026_05_v3";

/**
 * Personal tools — per-user Calendar Marker + My Notes. Two strictly
 * private, strictly additive tables available to every signed-in user
 * regardless of module roles:
 *
 *   • `calendar_marks` — one optional mark per (user, day): a short note
 *     plus a colour tag, surfaced in the week-view calendar. Upserted by
 *     (user_id, mark_date); clearing the note deletes the row.
 *   • `user_notes` — the user's own notebook. Each note has a title +
 *     body, soft-deleted via `deleted_at`, and can be exported to a
 *     branded PDF client-side.
 *
 * Both are owner-isolated by `user_id` and never read by any other
 * surface, so adding them is invisible to the rest of the app.
 */
const USER_TOOLS_FLAG = "user_tools_calendar_notes_v1_2026_05";
// 1.4A — retarget the Sales update note to the sales audience only (so
// presales no longer sees a sales-module note) and seed a presales-specific
// note for the new shared-queue lead workflow. Data-only migration; touches
// `news_posts` rows, never DDL.
// Bumped to _v2 for 1.4D: this block now PURGES the seeded release notes
// (Update notes is manual-only). Old DBs already past the original flag
// would otherwise keep the legacy rows; the flag bump re-runs the block
// once so the cleanup actually happens.
const V14A_FLAG = "v1_4a_update_notes_role_targeting_2026_05_v2";
// 1.4A — migrate leads to the shared-queue lifecycle. The old model used
// status 'distributed' for a manager-assigned lead; the new model calls a
// claimed lead 'in_progress'. Data-only (status rename), no DDL.
const LEAD_SHARED_QUEUE_FLAG = "lead_shared_queue_v1_4a_2026_05";
// Per-project technician to-do checklist.
const PROJECT_TASKS_FLAG = "project_tasks_v1_2026_06";
// Barcode/QR code on products for stock scanning.
const PRODUCT_BARCODE_FLAG = "product_barcode_v1_2026_06";
// One-time cleanup of company-kind client folders whose company is gone.
const ORPHAN_FOLDER_CLEANUP_FLAG = "orphan_company_folder_cleanup_v1_2026_06";
// Installation calculator rate book (conduit/cable/labor/location/accessory).
const INSTALLATION_RATES_FLAG = "installation_rates_v1_2026_06";
// Remember the sales project an RFQ was raised from (survives presales filing).
const LEADS_SALES_PROJECT_FLAG = "leads_sales_project_v1_2026_06";
// Multi-tenancy: a `tenants` table + `users.tenant_id`, seeded with one default
// tenant and every existing user backfilled into it (single-tenant-preserving).
const MULTITENANCY_FLAG = "multitenancy_tenants_v1_2026_06";
// Per-user department code (e.g. "ITD1") — the leading segment of every
// auto-generated quotation reference (<DEPT>-FO<YY>-<HEX>).
const DEPARTMENT_CODE_FLAG = "user_department_code_v1_2026_06";
// One-time realignment of every bigserial/serial sequence to max(id). A prior
// data restore loaded rows with explicit IDs without bumping the owning
// sequence, so the next auto-id collided with an existing row — surfacing as
// `duplicate key value violates unique constraint "<table>_pkey"` on the first
// insert (e.g. assign-role's activity_log audit write). Self-heals once.
const SEQUENCE_REALIGN_FLAG = "sequence_realign_v1_2026_06";

/**
 * Incremental migration: executive-manager confirmation. Adds the exec_*
 * sign-off columns to `quotations` and `pricing_projects` so presales can
 * submit an item and the executive manager can confirm / reject it.
 */
const EXEC_CONFIRMATION_FLAG = "exec_confirmation_v1_2026_07";

/**
 * Incremental migration: project distribution. A project manager distributes
 * a project to a technician / engineer with a scope of work, dates, status and
 * execution notes — plus client context (company / client / contact / email /
 * location) snapshotted from the folder but freely editable.
 */
const PROJECT_DISTRIBUTION_FLAG = "project_distribution_v1_2026_07";

/**
 * Incremental migration: per-manufacturer pricing defaults. Each pricing
 * manufacturer can carry default shipping / customs / profit rates that seed
 * the constants of every new pricing sheet created under it.
 */
const PRICING_MFG_DEFAULTS_FLAG = "pricing_mfg_defaults_v1_2026_07";

/** One-shot schema bootstrap. Idempotent — safe to run on every cold start. */
export async function ensureSchema(): Promise<void> {
  // In D1 mode (the default) apply the SQLite schema (d1/schema.sql)
  // idempotently on first use, so a fresh or stale D1 self-heals — the D1
  // analogue of the Postgres DDL bootstrap below. Guarded by a flag row so warm
  // processes pay just one SELECT; cached per process via __mtSchemaPromise.
  if (usingD1()) {
    if (globalForSchema.__mtSchemaPromise) return globalForSchema.__mtSchemaPromise;
    globalForSchema.__mtSchemaPromise = ensureD1SchemaOnce();
    return globalForSchema.__mtSchemaPromise;
  }
  if (globalForSchema.__mtSchemaPromise) return globalForSchema.__mtSchemaPromise;
  // Ensure DDL first, then seed the release-notes changelog. The seed lives
  // outside _ensureSchemaOnce's "nothing to do" early return so it still runs
  // on warm, already-bootstrapped databases.
  globalForSchema.__mtSchemaPromise = (async () => {
    await _ensureSchemaOnce();
    await _seedReleaseNotes();
  })();
  return globalForSchema.__mtSchemaPromise;
}

/**
 * Apply the D1 schema once per process. Fast path: a flag row in
 * `migration_flags` means it's already applied, so this is a single SELECT on
 * warm processes. On first run (or when the flag is missing) it applies every
 * idempotent CREATE/ALTER from d1/schema.sql, then records the flag. Bump the
 * FLAG string whenever d1/schema.sql gains new tables/columns so existing
 * databases pick them up.
 *
 * Best-effort: it never throws. If D1 is unreachable the failure surfaces on
 * the caller's real query (with a clear "D1 is not configured" message) rather
 * than here, and the flag isn't set so a later request retries.
 */
// Bumped 2026-06-30: the schema now ships the full index set ported from the
// Postgres bootstrap (see d1/schema.sql "Indexes" block). Bumping the flag makes
// existing D1 databases re-run applyD1Schema once so the new CREATE INDEX IF NOT
// EXISTS statements take effect — every statement is idempotent, so nothing is
// dropped or rewritten.
const D1_SCHEMA_FLAG = "d1_schema_bootstrap_2026_06_30_indexes";

/**
 * UNIQUE constraints the app's `INSERT ... ON CONFLICT (cols)` upserts depend
 * on. Postgres declares these as UNIQUE; the SQLite schema port dropped them, so
 * on D1 those upserts failed with "ON CONFLICT clause does not match any PRIMARY
 * KEY or UNIQUE constraint" — breaking Create user, folder create, role grant,
 * calendar marks, push subscribe, catalogue upload, notification state and the
 * manufacturer handover. SQLite honours a UNIQUE INDEX as an ON CONFLICT target.
 * d1/schema.sql now ships these for fresh databases; this self-heal adds them to
 * EXISTING ones, whose base-schema flag is already set (so applyD1Schema is
 * skipped on boot). Only tables whose ON CONFLICT column-set differs from the
 * PRIMARY KEY are listed — the rest already have a matching PK.
 */
const D1_UNIQUE_INDEXES_FLAG = "d1_unique_indexes_v1_2026_07";
const D1_UNIQUE_INDEXES: ReadonlyArray<{ name: string; sql: string }> = [
  { name: "users_username_key", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" ("username")` },
  { name: "client_folders_owner_name_key", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "client_folders_owner_name_key" ON "client_folders" ("owner_id", "name")` },
  { name: "notification_state_user_key_idx", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "notification_state_user_key_idx" ON "notification_state" ("user_id", "notif_key")` },
  { name: "pricing_user_manufacturers_uq", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "pricing_user_manufacturers_uq" ON "pricing_user_manufacturers" ("user_id", "manufacturer_id")` },
  { name: "products_model_key", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "products_model_key" ON "products" ("model")` },
  { name: "calendar_marks_user_date_idx", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "calendar_marks_user_date_idx" ON "calendar_marks" ("user_id", "mark_date")` },
  { name: "push_subscriptions_endpoint_key", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions" ("endpoint")` },
];

/**
 * Best-effort creation of the ON CONFLICT unique indexes on an existing D1
 * database. Each index is created independently so one table's pre-existing
 * duplicate can't block the others; the flag is recorded only once every index
 * is in place, so a dup-blocked table simply retries next boot (7 cheap
 * `IF NOT EXISTS` statements) instead of wedging the schema bootstrap.
 */
async function ensureD1UniqueIndexes(): Promise<void> {
  try {
    const r = await d1Query<{ one: number }>(
      `select 1 as one from migration_flags where key = ? limit 1`,
      [D1_UNIQUE_INDEXES_FLAG],
    );
    if (r.results.length > 0) return;
  } catch {
    // migration_flags may not exist yet — the base schema apply creates it.
  }
  let allOk = true;
  for (const idx of D1_UNIQUE_INDEXES) {
    try {
      await d1Query(idx.sql);
    } catch (err) {
      allOk = false;
      console.warn(
        `[d1] unique index ${idx.name} not created (likely pre-existing duplicate rows): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
  if (allOk) {
    await d1Query(`insert into migration_flags (key, ran_at) values (?, ?)`, [
      D1_UNIQUE_INDEXES_FLAG,
      new Date().toISOString(),
    ]).catch(() => {});
  }
}

/**
 * Column drift self-heal. The D1 schema (d1/schema.sql) grew columns over time
 * inside its CREATE TABLE definitions, but existing databases only get
 * `CREATE TABLE IF NOT EXISTS` (a no-op) on re-apply and there are ALTER
 * statements for just a handful of tables — so a database created before a
 * column existed is missing it, and any query that reads it throws
 * "no such column" (e.g. the dashboard reading quotations.sales_outcome /
 * transferred_at crashed for presales/sales users). This diffs every table's
 * schema columns against the live table (PRAGMA table_info) and ADDs the
 * missing ones. NOT NULL-without-default columns are skipped (SQLite can't ADD
 * those to a non-empty table — and they're structural, so they already exist).
 */
// Bumped 2026-07-06: the exec-confirmation, project-distribution and
// per-manufacturer pricing-default columns were added to the Postgres path only
// (via _ensureSchemaOnce migrations) and to the D1 CREATE TABLE defs, but an
// existing D1 database already had the v1 sync flag set — so ensureD1Columns
// early-returned and never added them, and every pricing read/save that touched
// pricing_projects threw "no such column". Bumping the flag forces existing D1
// databases to re-diff and ADD the missing columns exactly once.
const D1_COLUMN_SYNC_FLAG = "d1_column_sync_v2_2026_07";

type D1ColDef = { name: string; ddl: string };
let d1SchemaColsCache: Map<string, D1ColDef[]> | null = null;
function parseD1SchemaColumns(): Map<string, D1ColDef[]> {
  if (d1SchemaColsCache) return d1SchemaColsCache;
  const out = new Map<string, D1ColDef[]>();
  const tableRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(D1_SCHEMA_SQL))) {
    const table = m[1];
    const cols: D1ColDef[] = [];
    for (const rawLine of m[2].split("\n")) {
      const line = rawLine.trim().replace(/,\s*$/, "");
      if (!line) continue;
      // A column line starts with a quoted identifier; constraint lines
      // (PRIMARY KEY / FOREIGN KEY / UNIQUE / CHECK) do not.
      const cm = /^"(\w+)"\s+(.+)$/.exec(line);
      if (!cm) continue;
      const rest = cm[2];
      // SQLite can't ADD a NOT NULL column without a DEFAULT to a non-empty
      // table; those are structural columns present since creation anyway.
      if (/\bnot\s+null\b/i.test(rest) && !/\bdefault\b/i.test(rest)) continue;
      cols.push({ name: cm[1], ddl: `"${cm[1]}" ${rest}` });
    }
    out.set(table, cols);
  }
  d1SchemaColsCache = out;
  return out;
}

async function ensureD1Columns(): Promise<void> {
  try {
    const r = await d1Query<{ one: number }>(
      `select 1 as one from migration_flags where key = ? limit 1`,
      [D1_COLUMN_SYNC_FLAG],
    );
    if (r.results.length > 0) return;
  } catch {
    // migration_flags may not exist yet — the base schema apply creates it.
  }
  let allOk = true;
  for (const [table, cols] of parseD1SchemaColumns()) {
    if (cols.length === 0) continue;
    let existing: Set<string>;
    try {
      const info = await d1Query<{ name: string }>(
        `PRAGMA table_info("${table}")`,
      );
      existing = new Set(info.results.map((row) => String(row.name)));
    } catch {
      continue; // table unreadable — skip
    }
    if (existing.size === 0) continue; // table absent; the base schema creates it
    for (const col of cols) {
      if (existing.has(col.name)) continue;
      try {
        await d1Query(`ALTER TABLE "${table}" ADD COLUMN ${col.ddl}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/duplicate column/i.test(msg)) continue;
        allOk = false;
        console.warn(`[d1] add column ${table}.${col.name} failed: ${msg}`);
      }
    }
  }
  if (allOk) {
    await d1Query(`insert into migration_flags (key, ran_at) values (?, ?)`, [
      D1_COLUMN_SYNC_FLAG,
      new Date().toISOString(),
    ]).catch(() => {});
  }
}

async function ensureD1SchemaOnce(): Promise<void> {
  try {
    let baseApplied = false;
    try {
      const r = await d1Query<{ one: number }>(
        `select 1 as one from migration_flags where key = ? limit 1`,
        [D1_SCHEMA_FLAG],
      );
      baseApplied = r.results.length > 0;
    } catch {
      // migration_flags may not exist yet — fall through and apply the schema.
    }
    if (!baseApplied) {
      const { errors } = await applyD1Schema();
      if (errors.length === 0) {
        await d1Query(
          `insert into migration_flags (key, ran_at) values (?, ?)`,
          [D1_SCHEMA_FLAG, new Date().toISOString()],
        ).catch(() => {});
      }
    }
    // Add the ON CONFLICT unique indexes to existing databases (fresh ones get
    // them from the base schema above). Own flag; best-effort per index.
    await ensureD1UniqueIndexes();
    // Backfill any columns an older database is missing (schema grew its
    // CREATE TABLE defs but existing DBs don't get them). Own flag.
    await ensureD1Columns();
    // Full-text search lives outside the schema-split loader (it can't create
    // virtual tables/triggers), so apply it here. Has its own flag + in-memory
    // ready guard, so this is cheap on warm processes and never blocks the base
    // schema. Best-effort: a failure just leaves search on the ILIKE fallback.
    await ensureD1Fts();
  } catch {
    // Allow a retry on the next call instead of caching a rejected promise.
    globalForSchema.__mtSchemaPromise = undefined;
  }
}

/**
 * Force the schema bootstrap to run again on the next `ensureSchema()` call.
 *
 * Deletes the migration fingerprint rows from `migration_flags` so the DDL
 * block re-executes. All statements use `IF NOT EXISTS` / `IF EXISTS` guards
 * and `ON CONFLICT DO NOTHING` — **no data is ever dropped or overwritten**.
 * Quotations, folders, users and every other table's rows are completely safe.
 *
 * Call this from an admin endpoint when you want to force-apply a new
 * migration (e.g. the composite-index migration) without waiting for the
 * natural next cold start.
 */
export async function resetSchemaCache(): Promise<void> {
  // No Postgres DDL to replay in D1 mode (the default); just drop the cached
  // promise so a later USE_D1=0 boot re-runs the bootstrap.
  if (usingD1()) {
    globalForSchema.__mtSchemaPromise = undefined;
    return;
  }
  const q = sql();
  // Remove the two flags we control so _ensureSchemaOnce re-runs them.
  // The CRM backfill flag (client_folders_crm_v1) is intentionally left
  // alone — that migration has already filed quotations into folders and
  // re-running it is a no-op, but leaving the flag avoids the extra SELECTs.
  await q`
    delete from migration_flags
    where key in (
      ${SCHEMA_FINGERPRINT}, ${PERF_INDEX_FLAG}, ${QUOTATION_STATUS_FLAG},
      ${CRM_FOUNDATION_FLAG}, ${CRM_CONTACTS_FLAG}, ${CRM_DEALS_FLAG},
      ${CRM_TASKS_FLAG}, ${CRM_WORKFLOWS_FLAG}, ${CRM_TEAMS_FLAG},
      ${CRM_SEARCH_FLAG}, ${PERF_INDEX_V2_FLAG}, ${QUOTATION_CONTACT_FLAG},
      ${USER_PHONE_FLAG}, ${PURCHASE_ORDERS_FLAG}, ${CATALOGUE_PICTURE_FLAG},
      ${PROJECTS_FOUNDATION_FLAG}, ${MODULE_RBAC_V1_FLAG},
      ${MODULE_RBAC_REVOKE_FLAG}, ${LEAD_LIFECYCLE_FLAG},
      ${STOCK_CHECKS_FLAG}, ${PRICING_FOUNDATION_FLAG}
    )
  `;
  // Bust the in-process promise cache so the next ensureSchema() call
  // actually hits the database instead of returning the cached void.
  globalForSchema.__mtSchemaPromise = undefined;
}

async function _ensureSchemaOnce(): Promise<void> {
  const q = sql();

  // Fast path: read both the main schema fingerprint AND the incremental
  // performance-index flag in a single round-trip. On warm databases this
  // is the ONLY query this function executes. `migration_flags` itself
  // might not exist yet on a brand-new database (the rest of this function
  // creates it), so we swallow the "relation does not exist" error and fall
  // through to the full bootstrap.
  let schemaBootstrapped = false;
  let perfIndexesApplied = false;
  let quotationStatusApplied = false;
  let crmFoundationApplied = false;
  let crmContactsApplied = false;
  let crmDealsApplied = false;
  let crmTasksApplied = false;
  let crmWorkflowsApplied = false;
  let crmTeamsApplied = false;
  let crmSearchApplied = false;
  let perfIndexesV2Applied = false;
  let quotationContactApplied = false;
  let userPhoneApplied = false;
  let purchaseOrdersApplied = false;
  let cataloguePictureApplied = false;
  let projectsFoundationApplied = false;
  let moduleRbacApplied = false;
  let moduleRbacRevokeApplied = false;
  let leadLifecycleApplied = false;
  let stockChecksApplied = false;
  let pricingFoundationApplied = false;
  let notificationStateApplied = false;
  let projectHandoffsApplied = false;
  let v13bApplied = false;
  let v13cApplied = false;
  let v13dApplied = false;
  let userToolsApplied = false;
  let v14aApplied = false;
  let leadSharedQueueApplied = false;
  let projectTasksApplied = false;
  let productBarcodeApplied = false;
  let orphanFolderCleanupApplied = false;
  let installationRatesApplied = false;
  let leadsSalesProjectApplied = false;
  let multitenancyApplied = false;
  let departmentCodeApplied = false;
  let sequenceRealignApplied = false;
  let execConfirmationApplied = false;
  let projectDistributionApplied = false;
  let pricingMfgDefaultsApplied = false;
  try {
    const rows = (await q`
      select key from migration_flags
      where key in (
        ${SCHEMA_FINGERPRINT}, ${PERF_INDEX_FLAG}, ${QUOTATION_STATUS_FLAG},
        ${CRM_FOUNDATION_FLAG}, ${CRM_CONTACTS_FLAG}, ${CRM_DEALS_FLAG},
        ${CRM_TASKS_FLAG}, ${CRM_WORKFLOWS_FLAG}, ${CRM_TEAMS_FLAG},
        ${CRM_SEARCH_FLAG}, ${PERF_INDEX_V2_FLAG}, ${QUOTATION_CONTACT_FLAG},
        ${USER_PHONE_FLAG}, ${PURCHASE_ORDERS_FLAG}, ${CATALOGUE_PICTURE_FLAG},
        ${PROJECTS_FOUNDATION_FLAG}, ${MODULE_RBAC_V1_FLAG},
        ${MODULE_RBAC_REVOKE_FLAG}, ${LEAD_LIFECYCLE_FLAG},
        ${STOCK_CHECKS_FLAG}, ${PRICING_FOUNDATION_FLAG},
        ${NOTIFICATION_STATE_FLAG}, ${PROJECT_HANDOFFS_FLAG},
        ${V13B_FLAG}, ${V13C_FLAG}, ${V13D_FLAG}, ${USER_TOOLS_FLAG},
        ${V14A_FLAG}, ${LEAD_SHARED_QUEUE_FLAG}, ${PROJECT_TASKS_FLAG},
        ${PRODUCT_BARCODE_FLAG}, ${ORPHAN_FOLDER_CLEANUP_FLAG},
        ${INSTALLATION_RATES_FLAG}, ${LEADS_SALES_PROJECT_FLAG},
        ${MULTITENANCY_FLAG}, ${DEPARTMENT_CODE_FLAG},
        ${SEQUENCE_REALIGN_FLAG}, ${EXEC_CONFIRMATION_FLAG},
        ${PROJECT_DISTRIBUTION_FLAG}, ${PRICING_MFG_DEFAULTS_FLAG}
      )
    `) as Array<{ key: string }>;
    const keys = new Set(rows.map((r) => r.key));
    schemaBootstrapped = keys.has(SCHEMA_FINGERPRINT);
    perfIndexesApplied = keys.has(PERF_INDEX_FLAG);
    quotationStatusApplied = keys.has(QUOTATION_STATUS_FLAG);
    crmFoundationApplied = keys.has(CRM_FOUNDATION_FLAG);
    crmContactsApplied = keys.has(CRM_CONTACTS_FLAG);
    crmDealsApplied = keys.has(CRM_DEALS_FLAG);
    crmTasksApplied = keys.has(CRM_TASKS_FLAG);
    crmWorkflowsApplied = keys.has(CRM_WORKFLOWS_FLAG);
    crmTeamsApplied = keys.has(CRM_TEAMS_FLAG);
    crmSearchApplied = keys.has(CRM_SEARCH_FLAG);
    perfIndexesV2Applied = keys.has(PERF_INDEX_V2_FLAG);
    quotationContactApplied = keys.has(QUOTATION_CONTACT_FLAG);
    userPhoneApplied = keys.has(USER_PHONE_FLAG);
    purchaseOrdersApplied = keys.has(PURCHASE_ORDERS_FLAG);
    cataloguePictureApplied = keys.has(CATALOGUE_PICTURE_FLAG);
    projectsFoundationApplied = keys.has(PROJECTS_FOUNDATION_FLAG);
    moduleRbacApplied = keys.has(MODULE_RBAC_V1_FLAG);
    moduleRbacRevokeApplied = keys.has(MODULE_RBAC_REVOKE_FLAG);
    leadLifecycleApplied = keys.has(LEAD_LIFECYCLE_FLAG);
    stockChecksApplied = keys.has(STOCK_CHECKS_FLAG);
    pricingFoundationApplied = keys.has(PRICING_FOUNDATION_FLAG);
    notificationStateApplied = keys.has(NOTIFICATION_STATE_FLAG);
    projectHandoffsApplied = keys.has(PROJECT_HANDOFFS_FLAG);
    v13bApplied = keys.has(V13B_FLAG);
    v13cApplied = keys.has(V13C_FLAG);
    v13dApplied = keys.has(V13D_FLAG);
    userToolsApplied = keys.has(USER_TOOLS_FLAG);
    v14aApplied = keys.has(V14A_FLAG);
    leadSharedQueueApplied = keys.has(LEAD_SHARED_QUEUE_FLAG);
    projectTasksApplied = keys.has(PROJECT_TASKS_FLAG);
    productBarcodeApplied = keys.has(PRODUCT_BARCODE_FLAG);
    orphanFolderCleanupApplied = keys.has(ORPHAN_FOLDER_CLEANUP_FLAG);
    installationRatesApplied = keys.has(INSTALLATION_RATES_FLAG);
    leadsSalesProjectApplied = keys.has(LEADS_SALES_PROJECT_FLAG);
    multitenancyApplied = keys.has(MULTITENANCY_FLAG);
    departmentCodeApplied = keys.has(DEPARTMENT_CODE_FLAG);
    sequenceRealignApplied = keys.has(SEQUENCE_REALIGN_FLAG);
    execConfirmationApplied = keys.has(EXEC_CONFIRMATION_FLAG);
    projectDistributionApplied = keys.has(PROJECT_DISTRIBUTION_FLAG);
    pricingMfgDefaultsApplied = keys.has(PRICING_MFG_DEFAULTS_FLAG);
  } catch {
    // migration_flags missing or unreadable — run the full DDL below.
  }

  // All migrations already applied — nothing to do.
  if (
    schemaBootstrapped &&
    perfIndexesApplied &&
    quotationStatusApplied &&
    crmFoundationApplied &&
    crmContactsApplied &&
    crmDealsApplied &&
    crmTasksApplied &&
    crmWorkflowsApplied &&
    crmTeamsApplied &&
    crmSearchApplied &&
    perfIndexesV2Applied &&
    quotationContactApplied &&
    userPhoneApplied &&
    purchaseOrdersApplied &&
    cataloguePictureApplied &&
    projectsFoundationApplied &&
    moduleRbacApplied &&
    moduleRbacRevokeApplied &&
    leadLifecycleApplied &&
    stockChecksApplied &&
    pricingFoundationApplied &&
    notificationStateApplied &&
    projectHandoffsApplied &&
    v13bApplied &&
    v13cApplied &&
    v13dApplied &&
    userToolsApplied &&
    v14aApplied &&
    leadSharedQueueApplied &&
    projectTasksApplied &&
    productBarcodeApplied &&
    orphanFolderCleanupApplied &&
    installationRatesApplied &&
    leadsSalesProjectApplied &&
    multitenancyApplied &&
    departmentCodeApplied &&
    sequenceRealignApplied &&
    execConfirmationApplied &&
    projectDistributionApplied &&
    pricingMfgDefaultsApplied
  )
    return;

  if (!schemaBootstrapped) {
  await q`
    create table if not exists users (
      id            serial primary key,
      username      text unique not null,
      password_hash text not null,
      role          text not null default 'user',
      created_at    timestamptz not null default now()
    )
  `;
  await q`
    create table if not exists quotations (
      id            serial primary key,
      ref           text unique not null,
      owner_id      integer references users(id) on delete set null,
      project_name  text not null,
      client_name   text,
      client_email  text,
      client_phone  text,
      sales_engineer text,
      prepared_by   text,
      tax_percent   numeric not null default 16,
      site_name     text not null default 'SITE',
      items_json    jsonb not null default '[]'::jsonb,
      totals_json   jsonb not null default '{}'::jsonb,
      config_json   jsonb not null default '{}'::jsonb,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now()
    )
  `;
  // Additive migration for pre-existing databases (safe no-op if column exists).
  await q`
    alter table quotations add column if not exists config_json jsonb not null default '{}'::jsonb
  `;
  await q`
    create index if not exists quotations_owner_idx on quotations(owner_id)
  `;

  // ── User display name ────────────────────────────────────────────────────
  await q`
    alter table users add column if not exists display_name text not null default ''
  `;

  // ── Client folders for quotation organisation ────────────────────────────
  await q`
    create table if not exists client_folders (
      id         serial primary key,
      name       text unique not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
  await q`
    alter table client_folders add column if not exists updated_at timestamptz not null default now()
  `;
  // Per-user folder ownership. Legacy folders (NULL owner_id) are treated as
  // admin-owned / shared so they remain visible to admins after the migration.
  await q`
    alter table client_folders add column if not exists owner_id integer references users(id) on delete cascade
  `;
  await q`
    create index if not exists client_folders_owner_idx on client_folders(owner_id)
  `;
  // Folder names are unique **per owner**, not globally. Drop the old
  // unconditional unique constraint if it exists and replace with a
  // composite one so two users can each have a "Clients" folder.
  await q`alter table client_folders drop constraint if exists client_folders_name_key`;
  await q`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conrelid = 'client_folders'::regclass
          and conname = 'client_folders_owner_name_key'
      ) then
        alter table client_folders
          add constraint client_folders_owner_name_key unique (owner_id, name);
      end if;
    end $$
  `;
  await q`
    alter table quotations add column if not exists folder_id integer references client_folders(id) on delete set null
  `;
  await q`
    create index if not exists quotations_folder_idx on quotations(folder_id)
  `;

  // ── Client folder CRM fields ─────────────────────────────────────────────
  // Each client_folders row now doubles as a client record: the folder name is
  // the client/company name and these columns carry the rest of the contact
  // card. The Designer auto-populates each new quotation from the folder the
  // user picks, so client info is typed once per client instead of once per
  // quotation.
  await q`
    alter table client_folders add column if not exists client_email text
  `;
  await q`
    alter table client_folders add column if not exists client_phone text
  `;
  await q`
    alter table client_folders add column if not exists client_company text
  `;

  // ── Soft-delete / trash bin ──────────────────────────────────────────────
  // Nothing is ever hard-deleted through the normal UI. Both client folders
  // and quotations get a `deleted_at` timestamp; rows with a non-null value
  // are hidden from the regular list views and surfaced in /api/trash so the
  // user can restore them. There is no auto-purge.
  await q`
    alter table client_folders add column if not exists deleted_at timestamptz
  `;
  await q`
    alter table quotations add column if not exists deleted_at timestamptz
  `;
  await q`
    create index if not exists client_folders_deleted_idx on client_folders(deleted_at)
  `;
  await q`
    create index if not exists quotations_deleted_idx on quotations(deleted_at)
  `;

  // ── Migration tracking table ─────────────────────────────────────────────
  // Used to guard one-shot data backfills so they don't run on every cold
  // start. Keyed by a stable migration id so we can introduce more of these
  // in the future without risk of re-running the old ones.
  await q`
    create table if not exists migration_flags (
      key    text primary key,
      ran_at timestamptz not null default now()
    )
  `;

  // ── One-shot CRM backfill (client_folders_crm_v1) ────────────────────────
  // 1. For every existing folder missing client_email, copy the most recent
  //    quotation's client_email/client_phone (folder name already matches the
  //    typed client_name on the old quotations closely enough).
  // 2. For every quotation that's still "unfiled" but has a client_email (or
  //    at least a client_name), create one folder per distinct
  //    (owner_id, lowercased email or name) and file the quotation into it.
  // Guarded by migration_flags so this runs exactly once per database.
  const flagRows = (await q`
    select 1 from migration_flags where key = 'client_folders_crm_v1' limit 1
  `) as Array<{ ["?column?"]: number }>;
  if (flagRows.length === 0) {
    // Step 1 — backfill folder client_email/client_phone from their latest
    // quotation. `distinct on` + order picks the newest row per folder.
    await q`
      update client_folders f
      set client_email = coalesce(f.client_email, src.client_email),
          client_phone = coalesce(f.client_phone, src.client_phone),
          updated_at   = now()
      from (
        select distinct on (folder_id)
               folder_id, client_email, client_phone
        from quotations
        where folder_id is not null
          and deleted_at is null
          and (client_email is not null or client_phone is not null)
        order by folder_id, updated_at desc
      ) src
      where f.id = src.folder_id
        and f.client_email is null
    `;

    // Step 2 — fold unfiled quotations into per-owner client folders keyed on
    // a normalized client_email (fallback: client_name). We do this in two
    // sub-steps so the INSERT is idempotent: first create folders for groups
    // that don't have a match yet, then link every quotation to its folder.
    await q`
      with candidates as (
        select owner_id,
               nullif(lower(trim(client_email)), '')                        as norm_email,
               nullif(trim(coalesce(client_name, '')), '')                  as name_trim,
               nullif(trim(coalesce(client_email, '')), '')                 as email_trim,
               nullif(trim(coalesce(client_phone, '')), '')                 as phone_trim
        from quotations
        where folder_id is null
          and deleted_at is null
          and owner_id is not null
          and (
            nullif(trim(coalesce(client_email, '')), '') is not null
            or nullif(trim(coalesce(client_name, '')), '')  is not null
          )
      ),
      groups as (
        select owner_id,
               coalesce(norm_email, lower(name_trim))                        as group_key,
               max(name_trim)                                                as name_pick,
               max(email_trim)                                               as email_pick,
               max(phone_trim)                                               as phone_pick
        from candidates
        group by owner_id, coalesce(norm_email, lower(name_trim))
      )
      insert into client_folders (owner_id, name, client_email, client_phone)
      select g.owner_id,
             coalesce(g.name_pick, g.email_pick, 'Client'),
             g.email_pick,
             g.phone_pick
      from groups g
      where not exists (
        select 1 from client_folders cf
        where cf.owner_id = g.owner_id
          and (
            (g.email_pick is not null and lower(cf.client_email) = lower(g.email_pick))
            or lower(cf.name) = lower(coalesce(g.name_pick, g.email_pick, 'Client'))
          )
      )
      on conflict (owner_id, name) do nothing
    `;

    // Link the unfiled quotations to the newly-created (or matching) folders.
    await q`
      update quotations q
      set folder_id = cf.id
      from client_folders cf
      where q.folder_id is null
        and q.deleted_at is null
        and q.owner_id is not null
        and cf.deleted_at is null
        and cf.owner_id = q.owner_id
        and (
          (
            nullif(lower(trim(q.client_email)), '') is not null
            and lower(cf.client_email) = lower(trim(q.client_email))
          )
          or (
            nullif(trim(coalesce(q.client_name, '')), '') is not null
            and lower(cf.name) = lower(trim(q.client_name))
          )
        )
    `;

    await q`
      insert into migration_flags (key) values ('client_folders_crm_v1')
      on conflict (key) do nothing
    `;
  }

  // ── Application settings (admin-editable presets) ────────────────────────
  // Simple key/value store for global presets like the default Terms &
  // Conditions list and the printable footer/company address. Written from
  // the admin Settings tab and read by the Designer / QuotationViewer so
  // every new or opened quotation inherits the latest values.
  await q`
    create table if not exists app_settings (
      key        text primary key,
      value      jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `;

  // ── Products catalogue table ──────────────────────────────────────────────
  await q`
    create table if not exists products (
      id             serial primary key,
      vendor         text not null,
      system         text not null,
      category       text not null,
      sub_category   text not null default '',
      fast_view      text not null default '',
      model          text not null,
      description    text not null default '',
      currency       text not null default 'USD',
      price_si       numeric not null default 0,
      specifications text not null default '',
      created_at     timestamptz not null default now(),
      updated_at     timestamptz not null default now(),
      unique(model)
    )
  `;
  await q`create index if not exists products_vendor_system_idx on products(vendor, system)`;
  await q`create index if not exists products_model_idx on products(model)`;
  // Migrate: drop old (vendor, model) constraint, ensure model-only unique exists
  await q`alter table products drop constraint if exists products_vendor_model_key`;
  // Add model-only unique constraint if it doesn't already exist
  await q`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conrelid = 'products'::regclass
          and contype = 'u'
          and array_length(conkey, 1) = 1
          and conkey[1] = (
            select attnum from pg_attribute
            where attrelid = 'products'::regclass and attname = 'model'
          )
      ) then
        alter table products add constraint products_model_key unique (model);
      end if;
    end $$
  `;

  // Mark the schema as fully bootstrapped so the next cold start can
  // take the single-`select` fast path above instead of replaying all of
  // the CREATE / ALTER statements.
  await q`
    insert into migration_flags (key) values (${SCHEMA_FINGERPRINT})
    on conflict (key) do nothing
  `;
  } // end if (!schemaBootstrapped)

  // ── Incremental performance migration ────────────────────────────────────
  // Composite indexes on (owner_id, deleted_at) for the two most-hit list
  // queries. The previous single-column indexes forced Postgres to bitmap-
  // scan owner_idx and deleted_idx separately and intersect the results.
  // With a composite index it satisfies the full WHERE clause in one scan.
  // Guarded by its own migration flag so it runs exactly once per database
  // regardless of which deploy first triggers it.
  if (!perfIndexesApplied) {
    await q`
      create index if not exists quotations_owner_deleted_idx
      on quotations(owner_id, deleted_at)
    `;
    await q`
      create index if not exists client_folders_owner_deleted_idx
      on client_folders(owner_id, deleted_at)
    `;
    await q`
      insert into migration_flags (key) values (${PERF_INDEX_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Quotation status + parent_ref (Draft / Review snapshots) ─────────────
  // `status` drives the Designer's smart-REF suffix:
  //   - 'active' → no suffix, bumps the per-user `n` counter
  //   - 'draft'  → appends D<m> where m counts drafts under parent_ref
  //   - 'review' → appends R<m> where m counts reviews under parent_ref
  // `parent_ref` points at the ORIGINAL active quotation the snapshot was
  // taken from, so every draft/review of QA42226MT5 shares the anchor
  // "QA42226MT5" regardless of whether the user re-drafted from a previous
  // draft. NULL for active quotations.
  if (!quotationStatusApplied) {
    await q`
      alter table quotations add column if not exists status text not null default 'active'
    `;
    await q`
      alter table quotations add column if not exists parent_ref text
    `;
    await q`
      create index if not exists quotations_owner_status_idx
      on quotations(owner_id, status)
    `;
    await q`
      create index if not exists quotations_parent_ref_idx
      on quotations(parent_ref)
    `;
    await q`
      insert into migration_flags (key) values (${QUOTATION_STATUS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── CRM foundation: activity_log + custom_fields JSONB columns ───────────
  // Purely additive spine used by future CRM surfaces (Contacts, Companies,
  // Deals, Tasks, Dashboards). No existing reader touches these objects, so
  // adding them is invisible to the Quotation / Designer / Admin flows.
  //
  // `activity_log` is the audit trail / timeline: every CRM write path
  // records a row here via logActivity(...) so Contact 360° views, deal
  // history and analytics can be built from a single source of truth.
  //
  // `custom_fields` JSONB columns let CRM UI attach arbitrary metadata to
  // quotations and client folders without further ALTER TABLE churn. They
  // default to '{}'::jsonb and are NOT NULL so new inserts stay safe even
  // if the legacy code paths don't set them.
  if (!crmFoundationApplied) {
    await q`
      create table if not exists activity_log (
        id          bigserial primary key,
        owner_id    integer references users(id) on delete set null,
        actor_id    integer references users(id) on delete set null,
        entity_type text   not null,
        entity_id   bigint not null,
        verb        text   not null,
        meta_json   jsonb  not null default '{}'::jsonb,
        created_at  timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists activity_log_owner_idx
      on activity_log(owner_id, created_at desc)
    `;
    await q`
      create index if not exists activity_log_entity_idx
      on activity_log(entity_type, entity_id, created_at desc)
    `;
    await q`
      alter table quotations add column if not exists custom_fields jsonb not null default '{}'::jsonb
    `;
    await q`
      alter table client_folders add column if not exists custom_fields jsonb not null default '{}'::jsonb
    `;
    await q`
      insert into migration_flags (key) values (${CRM_FOUNDATION_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── CRM Phase 1: contacts + companies ────────────────────────────────────
  // companies are the "account" record; contacts are the people. Both attach
  // optionally to a client_folders row so the existing folder UX (used by
  // /quotation, /designer) continues to work — the folder remains the
  // authoritative client-record for quotation purposes.
  if (!crmContactsApplied) {
    await q`
      create table if not exists companies (
        id            serial primary key,
        owner_id      integer references users(id) on delete set null,
        folder_id     integer references client_folders(id) on delete set null,
        name          text not null,
        website       text,
        industry      text,
        size_bucket   text,
        notes         text,
        custom_fields jsonb not null default '{}'::jsonb,
        deleted_at    timestamptz,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`create index if not exists companies_owner_idx  on companies(owner_id, deleted_at)`;
    await q`create index if not exists companies_folder_idx on companies(folder_id)`;

    await q`
      create table if not exists contacts (
        id            serial primary key,
        owner_id      integer references users(id) on delete set null,
        folder_id     integer references client_folders(id) on delete set null,
        company_id    integer references companies(id) on delete set null,
        first_name    text,
        last_name     text,
        email         text,
        phone         text,
        title         text,
        notes         text,
        custom_fields jsonb not null default '{}'::jsonb,
        deleted_at    timestamptz,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`create index if not exists contacts_owner_idx   on contacts(owner_id, deleted_at)`;
    await q`create index if not exists contacts_folder_idx  on contacts(folder_id)`;
    await q`create index if not exists contacts_company_idx on contacts(company_id)`;
    await q`create index if not exists contacts_email_idx   on contacts(lower(email))`;

    await q`
      insert into migration_flags (key) values (${CRM_CONTACTS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── CRM Phase 2: pipelines + stages + deals ──────────────────────────────
  // A deal is a sales opportunity. It optionally references a quotation, so
  // existing quotations remain first-class and can be retroactively attached
  // to a deal without any data rewrite. Stages are owner-scoped so each user
  // can have their own pipeline configuration.
  if (!crmDealsApplied) {
    await q`
      create table if not exists pipelines (
        id          serial primary key,
        owner_id    integer references users(id) on delete set null,
        name        text not null,
        is_default  boolean not null default false,
        deleted_at  timestamptz,
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      )
    `;
    await q`create index if not exists pipelines_owner_idx on pipelines(owner_id, deleted_at)`;

    await q`
      create table if not exists pipeline_stages (
        id           serial primary key,
        pipeline_id  integer not null references pipelines(id) on delete cascade,
        name         text not null,
        position     integer not null default 0,
        win_prob     numeric not null default 0,
        is_won       boolean not null default false,
        is_lost      boolean not null default false,
        created_at   timestamptz not null default now()
      )
    `;
    await q`create index if not exists pipeline_stages_pipeline_idx on pipeline_stages(pipeline_id, position)`;

    await q`
      create table if not exists deals (
        id                serial primary key,
        owner_id          integer references users(id) on delete set null,
        pipeline_id       integer references pipelines(id) on delete set null,
        stage_id          integer references pipeline_stages(id) on delete set null,
        company_id        integer references companies(id) on delete set null,
        contact_id        integer references contacts(id) on delete set null,
        folder_id         integer references client_folders(id) on delete set null,
        quotation_id      integer references quotations(id) on delete set null,
        title             text not null,
        amount            numeric not null default 0,
        currency          text not null default 'USD',
        probability       numeric not null default 0,
        expected_close_at date,
        status            text not null default 'open', -- 'open' | 'won' | 'lost'
        custom_fields     jsonb not null default '{}'::jsonb,
        deleted_at        timestamptz,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now()
      )
    `;
    await q`create index if not exists deals_owner_idx     on deals(owner_id, deleted_at)`;
    await q`create index if not exists deals_stage_idx     on deals(stage_id)`;
    await q`create index if not exists deals_pipeline_idx  on deals(pipeline_id)`;
    await q`create index if not exists deals_quotation_idx on deals(quotation_id)`;

    await q`
      insert into migration_flags (key) values (${CRM_DEALS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── CRM Phase 3: tasks + notes + in-app notifications ────────────────────
  // Generic entity_type/entity_id pair so a task or note can attach to any
  // CRM record (contact, company, deal, quotation). Notifications are read by
  // the client polling /api/crm/notifications — no email or push provider.
  if (!crmTasksApplied) {
    await q`
      create table if not exists tasks (
        id            serial primary key,
        owner_id      integer references users(id) on delete set null,
        assignee_id   integer references users(id) on delete set null,
        entity_type   text,
        entity_id     bigint,
        title         text not null,
        description   text,
        due_at        timestamptz,
        priority      text not null default 'normal',
        status        text not null default 'open', -- 'open' | 'done' | 'cancelled'
        custom_fields jsonb not null default '{}'::jsonb,
        deleted_at    timestamptz,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`create index if not exists tasks_owner_idx    on tasks(owner_id, status, deleted_at)`;
    await q`create index if not exists tasks_assignee_idx on tasks(assignee_id, status, deleted_at)`;
    await q`create index if not exists tasks_entity_idx   on tasks(entity_type, entity_id)`;
    await q`create index if not exists tasks_due_idx      on tasks(due_at) where deleted_at is null and status = 'open'`;

    await q`
      create table if not exists notes (
        id          serial primary key,
        owner_id    integer references users(id) on delete set null,
        author_id   integer references users(id) on delete set null,
        entity_type text not null,
        entity_id   bigint not null,
        body        text not null,
        deleted_at  timestamptz,
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      )
    `;
    await q`create index if not exists notes_entity_idx on notes(entity_type, entity_id, created_at desc)`;
    await q`create index if not exists notes_owner_idx  on notes(owner_id, deleted_at)`;

    await q`
      create table if not exists notifications (
        id          bigserial primary key,
        user_id     integer not null references users(id) on delete cascade,
        kind        text not null,
        title       text not null,
        body        text,
        link        text,
        payload     jsonb not null default '{}'::jsonb,
        read_at     timestamptz,
        created_at  timestamptz not null default now()
      )
    `;
    await q`create index if not exists notifications_user_idx on notifications(user_id, read_at, created_at desc)`;

    await q`
      insert into migration_flags (key) values (${CRM_TASKS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── CRM Phase 5: workflows + workflow_runs ───────────────────────────────
  // Lightweight rule engine driven by a Vercel Cron tick. Triggers are
  // matched against activity_log entries (event-driven) or evaluated against
  // due dates / quotation status (scheduled).
  if (!crmWorkflowsApplied) {
    await q`
      create table if not exists workflows (
        id            serial primary key,
        owner_id      integer references users(id) on delete set null,
        name          text not null,
        trigger_kind  text not null, -- 'event' | 'schedule'
        trigger_json  jsonb not null default '{}'::jsonb,
        actions_json  jsonb not null default '[]'::jsonb,
        enabled       boolean not null default true,
        last_run_at   timestamptz,
        deleted_at    timestamptz,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`create index if not exists workflows_owner_idx on workflows(owner_id, deleted_at)`;
    await q`create index if not exists workflows_enabled_idx on workflows(enabled) where deleted_at is null`;

    await q`
      create table if not exists workflow_runs (
        id           bigserial primary key,
        workflow_id  integer not null references workflows(id) on delete cascade,
        status       text not null default 'ok', -- 'ok' | 'error'
        message      text,
        meta_json    jsonb not null default '{}'::jsonb,
        ran_at       timestamptz not null default now()
      )
    `;
    await q`create index if not exists workflow_runs_workflow_idx on workflow_runs(workflow_id, ran_at desc)`;

    await q`
      insert into migration_flags (key) values (${CRM_WORKFLOWS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── CRM Phase 6: teams + entity ACLs ─────────────────────────────────────
  // Owner-isolation stays as the floor; ACLs only GRANT additional access to
  // a team or another user. Legacy reads that filter on owner_id are unaffected.
  if (!crmTeamsApplied) {
    await q`
      create table if not exists teams (
        id          serial primary key,
        name        text not null unique,
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now()
      )
    `;
    await q`
      create table if not exists team_members (
        team_id   integer not null references teams(id) on delete cascade,
        user_id   integer not null references users(id) on delete cascade,
        role      text not null default 'member', -- 'owner' | 'member'
        joined_at timestamptz not null default now(),
        primary key (team_id, user_id)
      )
    `;
    await q`create index if not exists team_members_user_idx on team_members(user_id)`;

    await q`
      create table if not exists entity_acls (
        id              bigserial primary key,
        entity_type     text not null,
        entity_id       bigint not null,
        principal_kind  text not null, -- 'user' | 'team'
        principal_id    integer not null,
        perm            text not null default 'view', -- 'view' | 'edit'
        created_at      timestamptz not null default now()
      )
    `;
    await q`create unique index if not exists entity_acls_unique_idx on entity_acls(entity_type, entity_id, principal_kind, principal_id, perm)`;
    await q`create index if not exists entity_acls_principal_idx    on entity_acls(principal_kind, principal_id)`;

    await q`
      insert into migration_flags (key) values (${CRM_TEAMS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── CRM Phase 7: full-text search columns + GIN indexes ──────────────────
  // Postgres-native FTS — no external service. Each indexed table gets a
  // generated `search_tsv` column over the rendered text fields.
  if (!crmSearchApplied) {
    await q`
      alter table contacts add column if not exists search_tsv tsvector
      generated always as (
        to_tsvector('simple',
          coalesce(first_name,'') || ' ' ||
          coalesce(last_name,'')  || ' ' ||
          coalesce(email,'')      || ' ' ||
          coalesce(phone,'')      || ' ' ||
          coalesce(title,'')      || ' ' ||
          coalesce(notes,'')
        )
      ) stored
    `;
    await q`create index if not exists contacts_search_idx on contacts using gin(search_tsv)`;

    await q`
      alter table companies add column if not exists search_tsv tsvector
      generated always as (
        to_tsvector('simple',
          coalesce(name,'') || ' ' ||
          coalesce(website,'') || ' ' ||
          coalesce(industry,'') || ' ' ||
          coalesce(notes,'')
        )
      ) stored
    `;
    await q`create index if not exists companies_search_idx on companies using gin(search_tsv)`;

    await q`
      alter table deals add column if not exists search_tsv tsvector
      generated always as (
        to_tsvector('simple', coalesce(title,''))
      ) stored
    `;
    await q`create index if not exists deals_search_idx on deals using gin(search_tsv)`;

    await q`
      alter table quotations add column if not exists search_tsv tsvector
      generated always as (
        to_tsvector('simple',
          coalesce(ref,'')          || ' ' ||
          coalesce(project_name,'') || ' ' ||
          coalesce(client_name,'')  || ' ' ||
          coalesce(client_email,'') || ' ' ||
          coalesce(site_name,'')
        )
      ) stored
    `;
    await q`create index if not exists quotations_search_idx on quotations using gin(search_tsv)`;

    await q`
      insert into migration_flags (key) values (${CRM_SEARCH_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Incremental performance migration v2 ─────────────────────────────────
  // Composite indexes that target the dashboard + filtered list queries
  // under CRM load. Each one below maps to a specific hot query plan that
  // was previously doing a bitmap intersect or a seq-scan+filter:
  //
  //   activity_log(owner_id, created_at desc)  — summary verb GROUP BY per
  //                                              user, also the activity feed
  //   activity_log(owner_id, verb, created_at) — the 30-day verb histogram
  //   deals(owner_id, status, deleted_at)      — dashboard pipeline/won sums
  //   deals(pipeline_id, deleted_at)           — deals-by-pipeline list
  //   contacts(folder_id, deleted_at)          — folder-filtered contact list
  //   contacts(company_id, deleted_at)         — company-filtered contact list
  //   tasks(entity_type, entity_id, status)    — entity-scoped task lookup
  //   notifications(user_id, created_at desc)  — unread poll
  //   team_members(team_id)                    — member count aggregation
  //
  // All use CREATE INDEX IF NOT EXISTS so re-runs are no-ops. The flag only
  // stops the migration_flags insert from happening more than once.
  if (!perfIndexesV2Applied) {
    await q`create index if not exists activity_log_owner_created_idx
            on activity_log(owner_id, created_at desc)`;
    await q`create index if not exists activity_log_owner_verb_idx
            on activity_log(owner_id, verb, created_at desc)`;
    await q`create index if not exists deals_owner_status_idx
            on deals(owner_id, status, deleted_at)`;
    await q`create index if not exists deals_pipeline_deleted_idx
            on deals(pipeline_id, deleted_at)`;
    await q`create index if not exists contacts_folder_deleted_idx
            on contacts(folder_id, deleted_at)`;
    await q`create index if not exists contacts_company_deleted_idx
            on contacts(company_id, deleted_at)`;
    await q`create index if not exists tasks_entity_status_idx
            on tasks(entity_type, entity_id, status)`;
    await q`create index if not exists notifications_user_created_idx
            on notifications(user_id, created_at desc)`;
    await q`create index if not exists team_members_team_idx
            on team_members(team_id)`;
    await q`
      insert into migration_flags (key) values (${PERF_INDEX_V2_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Quotation→contact link ───────────────────────────────────────────────
  // Adds a nullable contact_id column on quotations referencing contacts(id).
  // Lets the CompanyDetail page show each contact's own quotations instead
  // of just lumping every folder quotation under the company. ON DELETE SET
  // NULL so soft-removing a contact never orphans a quotation row.
  if (!quotationContactApplied) {
    await q`
      alter table quotations
      add column if not exists contact_id integer
      references contacts(id) on delete set null
    `;
    await q`
      create index if not exists quotations_contact_idx
      on quotations(contact_id)
    `;
    await q`
      insert into migration_flags (key) values (${QUOTATION_CONTACT_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Per-user phone number ────────────────────────────────────────────────
  // Stamped onto each new quotation as the "Presales Engineer" phone in
  // the printed header. Defaults to empty string so existing rows stay
  // unchanged; the admin sets each user's number from the Admin → Users
  // surface after this migration runs.
  if (!userPhoneApplied) {
    await q`
      alter table users add column if not exists phone text not null default ''
    `;
    await q`
      insert into migration_flags (key) values (${USER_PHONE_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Purchase orders ──────────────────────────────────────────────────────
  // A PO is a sales-stage after a quotation is accepted. Optional link to
  // a quotation (quotation_id) so an ad-hoc PO is still expressible, and
  // owner-isolated like every other user-facing record. Soft-delete via
  // deleted_at so POs follow the same "nothing is ever hard-deleted"
  // guarantee as quotations and folders.
  if (!purchaseOrdersApplied) {
    await q`
      create table if not exists purchase_orders (
        id            serial primary key,
        owner_id      integer references users(id) on delete set null,
        quotation_id  integer references quotations(id) on delete set null,
        folder_id     integer references client_folders(id) on delete set null,
        po_number     text not null,
        supplier      text,
        client_name   text,
        project_name  text,
        amount        numeric not null default 0,
        currency      text not null default 'JOD',
        status        text not null default 'open',
        notes         text,
        issued_at     date,
        expected_at   date,
        deleted_at    timestamptz,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`create index if not exists purchase_orders_owner_idx on purchase_orders(owner_id, deleted_at)`;
    await q`create index if not exists purchase_orders_quotation_idx on purchase_orders(quotation_id)`;
    await q`create index if not exists purchase_orders_folder_idx on purchase_orders(folder_id)`;
    await q`create unique index if not exists purchase_orders_owner_number_idx on purchase_orders(owner_id, po_number) where deleted_at is null`;
    await q`
      insert into migration_flags (key) values (${PURCHASE_ORDERS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Catalogue product pictures ───────────────────────────────────────────
  // Adds a nullable `picture_url` text column to `products` so admins can
  // attach a small thumbnail per catalogue row. The value is a base64 data
  // URL produced by the existing client-side `compressDataUrl` helper
  // (already shipped for Designer item pictures), capped at ~200 KB after
  // compression so the products table doesn't bloat. Existing rows stay
  // NULL — no UI surface treats NULL as broken.
  if (!cataloguePictureApplied) {
    await q`
      alter table products add column if not exists picture_url text
    `;
    await q`
      insert into migration_flags (key) values (${CATALOGUE_PICTURE_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Projects layer ───────────────────────────────────────────────────────
  // Inserts an intermediate "project" entity between client folders and
  // the things filed under them (quotations, POs, BOQs, files). The user
  // confirmed every existing folder should get an auto-created "Default
  // Project" so legacy quotations never appear "unfiled" in the new UI.
  //
  // Critically: only the new `project_id` column is touched on existing
  // quotations / purchase_orders. Every other column (items_json, ref,
  // totals_json, status, …) is untouched, satisfying the user's
  // explicit "no single quotation will be touched" requirement.
  if (!projectsFoundationApplied) {
    // 1. projects table
    await q`
      create table if not exists projects (
        id          serial primary key,
        folder_id   integer not null references client_folders(id) on delete cascade,
        owner_id    integer references users(id) on delete set null,
        name        text not null,
        description text,
        status      text not null default 'open',
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now(),
        deleted_at  timestamptz
      )
    `;
    await q`
      create index if not exists projects_folder_idx on projects(folder_id, deleted_at)
    `;
    await q`
      create index if not exists projects_owner_idx on projects(owner_id, deleted_at)
    `;

    // 2. nullable project_id on quotations + purchase_orders. Nullable so
    //    legacy readers and any future ad-hoc quotation that isn't filed
    //    under a project still work. ON DELETE SET NULL so deleting a
    //    project doesn't cascade-lose the quotation; the row just goes
    //    back to "unfiled" state.
    await q`
      alter table quotations
      add column if not exists project_id integer references projects(id) on delete set null
    `;
    await q`
      create index if not exists quotations_project_idx on quotations(project_id)
    `;
    await q`
      alter table purchase_orders
      add column if not exists project_id integer references projects(id) on delete set null
    `;
    await q`
      create index if not exists purchase_orders_project_idx on purchase_orders(project_id)
    `;

    // 3. project_files table. The binary itself lives in object storage (R2);
    //    `storage_path` is the bucket-relative key the upload flow signs
    //    against. `kind` partitions the Files panel into Quotation / PO /
    //    BOQ / Other tabs without forcing four separate tables.
    await q`
      create table if not exists project_files (
        id            serial primary key,
        project_id    integer not null references projects(id) on delete cascade,
        owner_id      integer references users(id) on delete set null,
        kind          text not null default 'other',
        filename      text not null,
        mime          text not null default 'application/octet-stream',
        size_bytes    bigint not null default 0,
        storage_path  text not null,
        created_at    timestamptz not null default now(),
        deleted_at    timestamptz
      )
    `;
    await q`
      create index if not exists project_files_project_idx on project_files(project_id, deleted_at)
    `;
    await q`
      create index if not exists project_files_kind_idx on project_files(project_id, kind, deleted_at)
    `;

    // 4. Backfill, in two clean passes. The migration is idempotent:
    //    re-running the INSERT only creates projects for folders that
    //    don't already have one (NOT EXISTS guard), and the UPDATEs
    //    only touch rows whose project_id is currently NULL, so manual
    //    re-assignments performed after this migration are never undone.
    //    `updated_at` is intentionally NOT mentioned in either UPDATE
    //    so the existing value is preserved on every row — the user
    //    explicitly asked that no quotation be touched, and "the row
    //    suddenly shows a fresh edit timestamp" would violate that.
    await q`
      insert into projects (folder_id, owner_id, name, description, status)
      select cf.id, cf.owner_id, 'Default Project',
             'Auto-created when projects were introduced — feel free to rename or split into more focused projects.',
             'open'
      from client_folders cf
      where cf.deleted_at is null
        and not exists (
          select 1 from projects p
          where p.folder_id = cf.id and p.deleted_at is null
        )
    `;
    await q`
      update quotations
      set project_id = p.id
      from projects p
      where quotations.folder_id = p.folder_id
        and quotations.project_id is null
        and quotations.deleted_at is null
        and p.deleted_at is null
        and p.name = 'Default Project'
    `;
    await q`
      update purchase_orders
      set project_id = p.id
      from projects p
      where purchase_orders.folder_id = p.folder_id
        and purchase_orders.project_id is null
        and purchase_orders.deleted_at is null
        and p.deleted_at is null
        and p.name = 'Default Project'
    `;

    await q`
      insert into migration_flags (key) values (${PROJECTS_FOUNDATION_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!moduleRbacApplied) {
    // V2.0 PHASE 1 — module RBAC + structural foundation.
    //
    // Every statement below is purely additive. No DROP / DELETE / hard
    // UPDATE on user-owned data. Existing rows in client_folders, quotations,
    // users, teams, etc. keep every value they currently hold; columns we
    // add are nullable so legacy code paths never observe a change.
    //
    // The block also re-runs the idempotent Default-Project backfill so any
    // folders / quotations created since 2026-04-26 (when the original
    // projects_foundation migration ran) get re-parented. The original
    // statements are NOT EXISTS / IS NULL guarded so re-running is a no-op
    // for already-migrated rows.

    // 1. Per-user, per-module role grants. A user may hold many (e.g.
    //    sales + presales + engineer) and the composite PK prevents
    //    duplicates without us needing a separate uniqueness check.
    await q`
      create table if not exists user_module_roles (
        user_id    integer not null references users(id) on delete cascade,
        module     text not null check (module in ('crm','projects','storage','admin','pricing')),
        role       text not null,
        granted_by integer references users(id) on delete set null,
        created_at timestamptz not null default now(),
        primary key (user_id, module, role)
      )
    `;
    await q`
      create index if not exists user_module_roles_module_idx
        on user_module_roles(module, role)
    `;

    // 2. Teams gain a module and a manager. team_members.role already
    //    exists, so the member-side schema is unchanged. deleted_at lets
    //    admins archive a team without losing its history.
    await q`
      alter table teams
        add column if not exists module text
          check (module is null or module in ('crm','projects','storage'))
    `;
    await q`
      alter table teams
        add column if not exists manager_user_id integer references users(id) on delete set null
    `;
    await q`
      alter table teams
        add column if not exists deleted_at timestamptz
    `;
    await q`
      create index if not exists teams_module_idx
        on teams(module, deleted_at)
    `;

    // 3. client_folders: distinguish Company vs Individual and link to the
    //    canonical companies row. `kind` stays NULL on existing rows —
    //    those 58 folders surface in the admin Migration Quarantine UI
    //    (Phase 3) for manual classification. We intentionally do NOT
    //    default to 'company' to avoid auto-tagging individual clients
    //    incorrectly.
    await q`
      alter table client_folders
        add column if not exists kind text
          check (kind is null or kind in ('company','individual'))
    `;
    await q`
      alter table client_folders
        add column if not exists company_id integer references companies(id) on delete set null
    `;
    await q`
      create index if not exists client_folders_kind_idx
        on client_folders(kind, deleted_at)
    `;

    // 4. Quotation dual approval. Sales-manager + Presales-manager must
    //    both sign before a quotation becomes visible to the Projects
    //    module. The existing `status` text column is untouched here;
    //    Phase 2 will extend the allowed values once the approval UI
    //    lands. Rejected quotations keep their row — `rejected_at` is
    //    just a timestamp, the data is preserved for audit.
    await q`
      alter table quotations
        add column if not exists sales_approved_by integer references users(id) on delete set null
    `;
    await q`
      alter table quotations
        add column if not exists sales_approved_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists presales_approved_by integer references users(id) on delete set null
    `;
    await q`
      alter table quotations
        add column if not exists presales_approved_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists approved_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists accepted_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists rejected_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists rejected_by integer references users(id) on delete set null
    `;
    await q`
      alter table quotations
        add column if not exists rejected_reason text
    `;
    await q`
      create index if not exists quotations_approval_idx
        on quotations(approved_at, accepted_at, deleted_at)
    `;

    // 5. Projects-module assignment table. Maps a Projects-module user to
    //    a project with a role and an "info window" (location + date
    //    range + notes) that the project manager controls. Engineers
    //    only see assignments they're part of; managers see everything
    //    under their team.
    await q`
      create table if not exists project_assignments (
        id          bigserial primary key,
        project_id  integer not null references projects(id) on delete cascade,
        user_id     integer not null references users(id) on delete cascade,
        role        text not null check (role in ('technical','engineer','manager')),
        assigned_by integer references users(id) on delete set null,
        location    text,
        start_date  date,
        end_date    date,
        notes       text,
        created_at  timestamptz not null default now(),
        deleted_at  timestamptz
      )
    `;
    await q`
      create index if not exists project_assignments_user_idx
        on project_assignments(user_id, deleted_at)
    `;
    await q`
      create index if not exists project_assignments_project_idx
        on project_assignments(project_id, deleted_at)
    `;

    // 6. Storage module — V1.5A.
    //    The legacy flat inventory model (storage_locations / storage_stock /
    //    storage_requests) was REMOVED in V1.5A. It is superseded by the
    //    event-sourced, tree-based, multi-node stock model spec'd in
    //    docs/storage-module-v1.5A.md (one append-only stock_events ledger as
    //    the source of truth; totals derived, never stored). The legacy
    //    tables were dropped from the database; nothing recreates them here.
    //    The BOQ availability check below (quotation_stock_checks) is a
    //    quotation feature and is intentionally retained.

    // BOQ availability checks. When a presales engineer wants to know
    // whether the warehouse can fulfil a draft quotation, they fire one
    // of these off from the QuotationViewer. We snapshot the items list
    // into `items_json` so the record stays meaningful even if the
    // quotation is later edited, and the storage team writes back the
    // per-item answer into `reply_json`. The partial unique index
    // enforces "only one open check per quotation at a time" — the
    // requester's button is disabled in the UI until storage answers
    // (or the row is cancelled), but the DB is the actual source of
    // truth in case of a race.
    await q`
      create table if not exists quotation_stock_checks (
        id            bigserial primary key,
        quotation_id  integer not null references quotations(id) on delete cascade,
        requested_by  integer not null references users(id) on delete set null,
        status        text not null default 'pending'
          check (status in ('pending','answered','cancelled')),
        items_json    jsonb not null,
        reply_json    jsonb,
        storage_notes text,
        answered_by   integer references users(id) on delete set null,
        answered_at   timestamptz,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists quotation_stock_checks_q_idx
        on quotation_stock_checks(quotation_id, created_at desc)
    `;
    await q`
      create index if not exists quotation_stock_checks_status_idx
        on quotation_stock_checks(status, created_at desc)
    `;
    await q`
      create unique index if not exists quotation_stock_checks_one_pending_idx
        on quotation_stock_checks(quotation_id)
        where status = 'pending'
    `;

    // 6b. Storage V1.5A — event-sourced stock foundation.
    //     Source of truth = the append-only `stock_events` ledger;
    //     `stock_placements` is a derived (item, node) on-hand cache updated
    //     in the SAME transaction as each event (item total = sum of its
    //     placements). Locations are a self-referencing TREE (any depth,
    //     freely editable) and items carry a per-item reorder point.
    //     See docs/storage-module-v1.5A.md.
    await q`
      create table if not exists stock_location_nodes (
        id         serial primary key,
        parent_id  integer references stock_location_nodes(id) on delete cascade,
        name       text not null,
        created_at timestamptz not null default now(),
        deleted_at timestamptz
      )
    `;
    await q`
      create index if not exists stock_location_nodes_parent_idx
        on stock_location_nodes(parent_id)
    `;
    await q`
      create table if not exists stock_item_settings (
        item_id       integer primary key references products(id) on delete cascade,
        reorder_point integer not null default 0 check (reorder_point >= 0),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`
      create table if not exists stock_events (
        id           bigserial primary key,
        event_uid    uuid not null default gen_random_uuid() unique,
        item_id      integer not null references products(id) on delete cascade,
        type         text not null check (type in ('IN','OUT','MOVE','ADJUST')),
        qty          integer not null check (qty > 0),
        from_node_id integer references stock_location_nodes(id),
        to_node_id   integer references stock_location_nodes(id),
        actor_id     integer references users(id) on delete set null,
        method       text not null default 'manual'
          check (method in ('scan','manual','import','sync')),
        reason       text,
        occurred_at  timestamptz not null default now(),
        recorded_at  timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists stock_events_item_idx
        on stock_events(item_id, recorded_at desc)
    `;
    await q`
      create table if not exists stock_placements (
        item_id    integer not null references products(id) on delete cascade,
        node_id    integer not null references stock_location_nodes(id) on delete cascade,
        qty        integer not null default 0 check (qty >= 0),
        updated_at timestamptz not null default now(),
        primary key (item_id, node_id)
      )
    `;
    await q`
      create index if not exists stock_placements_node_idx
        on stock_placements(node_id)
    `;

    // 7. Admin-curated dashboard announcements. Audience targeting is
    //    array-based so a single post can target multiple modules / roles
    //    without a join table. Pinned posts float to the top.
    await q`
      create table if not exists news_posts (
        id               bigserial primary key,
        title            text not null,
        body             text not null,
        audience_modules text[] not null default array['all']::text[],
        audience_roles   text[] not null default array['all']::text[],
        pinned           boolean not null default false,
        created_by       integer references users(id) on delete set null,
        created_at       timestamptz not null default now(),
        expires_at       timestamptz,
        deleted_at       timestamptz
      )
    `;
    await q`
      create index if not exists news_posts_active_idx
        on news_posts(pinned desc, created_at desc)
        where deleted_at is null
    `;

    // 8. Seed admin module roles ONLY for users already marked
    //    `users.role = 'admin'`. Everyone else gets ZERO module grants
    //    here — they keep their current legacy access via users.role
    //    and surface in the admin "Pending role assignment" queue
    //    (Phase 3 UI) so an admin can grant CRM / Projects / Storage
    //    explicitly. This matches the user's "do not auto-assign,
    //    route to a reassignment surface" rule.
    await q`
      insert into user_module_roles (user_id, module, role)
      select id, 'admin', 'admin' from users where role = 'admin'
      on conflict do nothing
    `;

    // 9. Catch-up Default-Project backfill. The original
    //    projects_foundation flag fired on 2026-04-26; since then 25
    //    folders and 29 quotations were created without a project_id.
    //    Re-run the same idempotent INSERT/UPDATE so the upcoming
    //    Phase 2 UI (which filters by project_id) sees every row.
    //    Identical wording — NOT EXISTS / IS NULL — keeps this a no-op
    //    for rows already migrated.
    await q`
      insert into projects (folder_id, owner_id, name, description, status)
      select cf.id, cf.owner_id, 'Default Project',
             'Auto-created when projects were introduced — feel free to rename or split into more focused projects.',
             'open'
      from client_folders cf
      where cf.deleted_at is null
        and not exists (
          select 1 from projects p
          where p.folder_id = cf.id and p.deleted_at is null
        )
    `;
    await q`
      update quotations
      set project_id = p.id
      from projects p
      where quotations.folder_id = p.folder_id
        and quotations.project_id is null
        and quotations.deleted_at is null
        and p.deleted_at is null
        and p.name = 'Default Project'
    `;
    await q`
      update purchase_orders
      set project_id = p.id
      from projects p
      where purchase_orders.folder_id = p.folder_id
        and purchase_orders.project_id is null
        and purchase_orders.deleted_at is null
        and p.deleted_at is null
        and p.name = 'Default Project'
    `;

    await q`
      insert into migration_flags (key) values (${MODULE_RBAC_V1_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!moduleRbacRevokeApplied) {
    // Soft-revoke for user_module_roles. We never DELETE a grant: the
    // PATCH endpoint sets revoked_at + revoked_by so "who had access
    // when" is permanently auditable, and re-granting later is a fresh
    // INSERT into the same composite key with revoked_at NULL. Active
    // grants are filtered with `revoked_at is null` everywhere.
    await q`
      alter table user_module_roles
        add column if not exists revoked_at timestamptz
    `;
    await q`
      alter table user_module_roles
        add column if not exists revoked_by integer references users(id) on delete set null
    `;
    await q`
      create index if not exists user_module_roles_active_idx
        on user_module_roles(user_id, module)
        where revoked_at is null
    `;

    await q`
      insert into migration_flags (key) values (${MODULE_RBAC_REVOKE_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!leadLifecycleApplied) {
    // Lead lifecycle workflow tables. Strictly additive — nothing existing
    // is touched. Soft-delete (`deleted_at`) on the leads row and FK
    // ON DELETE SET NULL on every link so the lead survives even if its
    // linked company / folder / contact / quotation / file is later
    // archived. The status text column doubles as the workflow stage. Since
    // 1.4A the lifecycle is a shared presales queue (see /lib/leadConstants):
    //
    //   new          — opened by sales (the RFQ). Sits unclaimed in the
    //                  shared presales queue.
    //   in_progress  — a presales person claimed it (assigned_to_id) and is
    //                  turning it into a company / client / project. The
    //                  actual quotation / project work continues in the CRM
    //                  client area.
    //
    // (Pre-1.4A rows used 'distributed'; the V14A lead migration renames
    //  those to 'in_progress'.)
    //
    // Older deployments may still hold rows in legacy stages (assigned,
    // in_progress, quotation_sent, won, lost, …); the UI renders their raw
    // status as a fallback. The status column is plain text (no CHECK
    // constraint) so the range is enforced in the API layer
    // (`/lib/leads.ts`). The downstream link columns below (quotation_id,
    // outcome, boq_file_id, execution_assignee_id, …) are retained for
    // those legacy rows but are no longer written by the lead flow.
    await q`
      create table if not exists leads (
        id                       serial primary key,
        ref                      text unique not null,
        title                    text not null,
        description              text,
        source                   text,
        priority                 text not null default 'normal',
        status                   text not null default 'new',

        created_by               integer references users(id) on delete set null,
        requested_timeline_at    date,

        presales_manager_id      integer references users(id) on delete set null,
        assigned_to_id           integer references users(id) on delete set null,
        assigned_at              timestamptz,

        company_id               integer references companies(id) on delete set null,
        folder_id                integer references client_folders(id) on delete set null,
        contact_id               integer references contacts(id) on delete set null,

        quotation_id             integer references quotations(id) on delete set null,
        quotation_sent_at        timestamptz,
        quotation_email_subject  text,
        quotation_email_body     text,

        outcome                  text,
        outcome_by               integer references users(id) on delete set null,
        outcome_at               timestamptz,
        outcome_reason           text,

        boq_file_id              integer references project_files(id) on delete set null,
        boq_uploaded_at          timestamptz,

        execution_assignee_id    integer references users(id) on delete set null,
        sent_to_execution_at     timestamptz,
        project_id               integer references projects(id) on delete set null,

        completed_at             timestamptz,
        deleted_at               timestamptz,
        created_at               timestamptz not null default now(),
        updated_at               timestamptz not null default now()
      )
    `;
    await q`create index if not exists leads_status_idx           on leads(status, deleted_at)`;
    await q`create index if not exists leads_created_by_idx       on leads(created_by, deleted_at)`;
    await q`create index if not exists leads_assigned_to_idx      on leads(assigned_to_id, status, deleted_at)`;
    await q`create index if not exists leads_outcome_idx          on leads(outcome, outcome_at)`;
    await q`create index if not exists leads_execution_idx        on leads(execution_assignee_id, deleted_at)`;
    await q`create index if not exists leads_company_idx          on leads(company_id)`;
    await q`create index if not exists leads_folder_idx           on leads(folder_id)`;
    await q`create index if not exists leads_quotation_idx        on leads(quotation_id)`;

    // Per-lead audit trail / timeline. Every transition writes one row so
    // the Lead Detail page can render the full history without re-deriving
    // it from disparate sources. `verb` is the canonical event name
    // (created, assigned, status_changed, note, quotation_sent, …),
    // `message` is a human-readable line, and `meta_json` carries any
    // structured payload (eg. the new status, the recipient user).
    await q`
      create table if not exists lead_events (
        id          bigserial primary key,
        lead_id     integer not null references leads(id) on delete cascade,
        actor_id    integer references users(id) on delete set null,
        verb        text not null,
        message     text,
        meta_json   jsonb not null default '{}'::jsonb,
        created_at  timestamptz not null default now()
      )
    `;
    await q`create index if not exists lead_events_lead_idx
            on lead_events(lead_id, created_at desc)`;

    // Email-styled in-app messages. Today these surface via the TopBar
    // bell and lead notifications; tomorrow a real
    // SMTP / API integration can populate `external_message_id` and
    // `delivered_at` without another migration. The matching
    // `users.email` column ships now so the eventual wire-up has
    // an address to send to. `kind` is the trigger that produced the
    // message (lead_assigned, quotation_sent_to_sales, …) so the inbox
    // can group / colour / filter.
    await q`
      create table if not exists lead_messages (
        id                   bigserial primary key,
        lead_id              integer references leads(id) on delete cascade,
        sender_id            integer references users(id) on delete set null,
        recipient_id         integer not null references users(id) on delete cascade,
        kind                 text not null default 'general',
        subject              text not null,
        body                 text not null,
        read_at              timestamptz,
        external_message_id  text,
        delivered_at         timestamptz,
        created_at           timestamptz not null default now()
      )
    `;
    await q`create index if not exists lead_messages_recipient_idx
            on lead_messages(recipient_id, read_at, created_at desc)`;
    await q`create index if not exists lead_messages_lead_idx
            on lead_messages(lead_id, created_at desc)`;

    // Address for the future email integration. NULL means "no email on
    // file yet" — the lead workflow degrades to in-app inbox only for
    // that user, exactly the same way every other user is handled today.
    await q`alter table users add column if not exists email text`;

    await q`
      insert into migration_flags (key) values (${LEAD_LIFECYCLE_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!stockChecksApplied) {
    // Recreate quotation_stock_checks for databases that applied the
    // MODULE_RBAC_V1 flag before the table block existed. CREATE IF NOT
    // EXISTS keeps it a no-op everywhere the table is already there.
    await q`
      create table if not exists quotation_stock_checks (
        id            bigserial primary key,
        quotation_id  integer not null references quotations(id) on delete cascade,
        requested_by  integer not null references users(id) on delete set null,
        status        text not null default 'pending'
          check (status in ('pending','answered','cancelled')),
        items_json    jsonb not null,
        reply_json    jsonb,
        storage_notes text,
        answered_by   integer references users(id) on delete set null,
        answered_at   timestamptz,
        created_at    timestamptz not null default now(),
        updated_at    timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists quotation_stock_checks_q_idx
        on quotation_stock_checks(quotation_id, created_at desc)
    `;
    await q`
      create index if not exists quotation_stock_checks_status_idx
        on quotation_stock_checks(status, created_at desc)
    `;
    await q`
      create unique index if not exists quotation_stock_checks_one_pending_idx
        on quotation_stock_checks(quotation_id)
        where status = 'pending'
    `;
    await q`
      insert into migration_flags (key) values (${STOCK_CHECKS_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!pricingFoundationApplied) {
    // The user_module_roles CHECK constraint on existing databases was
    // created before "pricing" was a valid module name. Postgres assigns
    // the inline check the auto-name `user_module_roles_module_check`;
    // DROP-then-ADD swaps it for a wider one. The fresh-DB path's inline
    // CREATE TABLE already lists 'pricing' so this ALTER is a no-op there.
    await q`
      alter table user_module_roles
        drop constraint if exists user_module_roles_module_check
    `;
    await q`
      alter table user_module_roles
        add constraint user_module_roles_module_check
        check (module in ('crm','projects','storage','admin','pricing'))
    `;

    // Manufacturers visible system-wide. `created_by_user_id` is the
    // creator's user id (null when an admin pre-seeds one). Color/tag at
    // this level only matter for the admin's global view; per-user
    // overrides live in pricing_user_manufacturers.
    await q`
      create table if not exists pricing_manufacturers (
        id                  bigserial primary key,
        name                text   not null,
        color               text,
        tag                 text,
        created_by_user_id  integer references users(id) on delete set null,
        created_at          timestamptz not null default now(),
        deleted_at          timestamptz
      )
    `;
    await q`
      create index if not exists pricing_manufacturers_active_idx
        on pricing_manufacturers(deleted_at)
        where deleted_at is null
    `;

    // Per-user mapping table so non-admins only see manufacturers they
    // were granted access to, with their own colour/tag override. Admins
    // bypass this and see all rows.
    await q`
      create table if not exists pricing_user_manufacturers (
        id              bigserial primary key,
        user_id         integer not null references users(id) on delete cascade,
        manufacturer_id integer not null references pricing_manufacturers(id) on delete cascade,
        color           text not null default 'cyan',
        tag             text not null default '',
        created_at      timestamptz not null default now(),
        deleted_at      timestamptz,
        unique (user_id, manufacturer_id)
      )
    `;
    await q`
      create index if not exists pricing_user_manufacturers_user_idx
        on pricing_user_manufacturers(user_id)
        where deleted_at is null
    `;

    // A pricing project is one manufacturer's pricing sheet for one job.
    // `user_id` is the owning user; admins bypass the ownership filter.
    // `parent_project_id` + `revision_number` model the "Save as Revision"
    // lineage so the user can compare current pricing against historical
    // takes for the same project.
    await q`
      create table if not exists pricing_projects (
        id                  bigserial primary key,
        name                text   not null,
        date                text,
        responsible_person  text,
        manufacturer_id     integer not null references pricing_manufacturers(id) on delete cascade,
        user_id             integer references users(id) on delete set null,
        parent_project_id   integer references pricing_projects(id) on delete set null,
        revision_number     integer not null default 1,
        created_at          timestamptz not null default now(),
        deleted_at          timestamptz
      )
    `;
    await q`
      create index if not exists pricing_projects_user_idx
        on pricing_projects(user_id)
        where deleted_at is null
    `;
    await q`
      create index if not exists pricing_projects_manufacturer_idx
        on pricing_projects(manufacturer_id)
        where deleted_at is null
    `;

    // One row per project — the constants snapshot used when calculating
    // every line in that project. Defaults match the pricing-sheet app's
    // out-of-the-box numbers.
    await q`
      create table if not exists pricing_project_constants (
        id              bigserial primary key,
        project_id      integer not null unique references pricing_projects(id) on delete cascade,
        currency_rate   numeric(10, 6) not null default 0.710000,
        shipping_rate   numeric(10, 6) not null default 0.150000,
        customs_rate    numeric(10, 6) not null default 0.120000,
        profit_margin   numeric(10, 6) not null default 0.250000,
        tax_rate        numeric(10, 6) not null default 0.160000,
        target_currency text not null default 'JOD',
        source_currency text not null default 'USD'
      )
    `;

    // The actual line items. (project_id, position) is the visual order
    // used in the sheet; per-row overrides let the user pin one line's
    // shipping/customs/profit treatment when the global constants don't
    // fit (e.g. an item that ships free).
    await q`
      create table if not exists pricing_product_lines (
        id                      bigserial primary key,
        project_id              integer not null references pricing_projects(id) on delete cascade,
        position                integer not null,
        item_model              text not null default '',
        price_usd               numeric(12, 4) not null default 0,
        quantity                integer not null default 1,
        shipping_override       numeric(12, 4),
        customs_override        numeric(12, 4),
        shipping_rate_override  numeric(10, 6),
        customs_rate_override   numeric(10, 6),
        profit_rate_override    numeric(10, 6),
        unique (project_id, position)
      )
    `;
    await q`
      create index if not exists pricing_product_lines_project_idx
        on pricing_product_lines(project_id)
    `;

    await q`
      insert into migration_flags (key) values (${PRICING_FOUNDATION_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!notificationStateApplied) {
    // Per-user read / removed state for the notification + messages feed.
    // `notif_key` is a stable string the API derives for each item
    // (e.g. "approvals.pending", "news:42"). UPSERT on (user_id,
    // notif_key) keeps exactly one row per item per user.
    await q`
      create table if not exists notification_state (
        id          bigserial primary key,
        user_id     integer not null references users(id) on delete cascade,
        notif_key   text not null,
        status      text not null check (status in ('read','removed')),
        created_at  timestamptz not null default now(),
        updated_at  timestamptz not null default now(),
        unique (user_id, notif_key)
      )
    `;
    await q`
      create index if not exists notification_state_user_idx
        on notification_state(user_id)
    `;
    await q`
      insert into migration_flags (key) values (${NOTIFICATION_STATE_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!projectHandoffsApplied) {
    // Convert-to-Project handoffs. `boq_snapshot` freezes the quotation's
    // line items + totals at conversion time so the BOQ the project team
    // executes can't drift if the quotation is later edited. `status`
    // walks pending_assignment → assigned → completed (or cancelled).
    await q`
      create table if not exists project_handoffs (
        id                bigserial primary key,
        quotation_id      integer references quotations(id) on delete set null,
        project_id        integer references projects(id) on delete set null,
        folder_id         integer references client_folders(id) on delete set null,
        created_by        integer references users(id) on delete set null,
        status            text not null default 'pending_assignment'
                            check (status in ('pending_assignment','assigned','completed','cancelled')),
        contact_name      text,
        contact_phones    text,
        site_address      text,
        location_lat      double precision,
        location_lng      double precision,
        priority          text not null default 'normal'
                            check (priority in ('low','normal','high','urgent')),
        notes             text,
        boq_snapshot      jsonb not null default '[]'::jsonb,
        assigned_user_id  integer references users(id) on delete set null,
        assigned_by       integer references users(id) on delete set null,
        assigned_at       timestamptz,
        completed_at      timestamptz,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists project_handoffs_status_idx
        on project_handoffs(status)
        where status = 'pending_assignment'
    `;
    await q`
      create index if not exists project_handoffs_assignee_idx
        on project_handoffs(assigned_user_id)
    `;
    await q`
      create index if not exists project_handoffs_creator_idx
        on project_handoffs(created_by)
    `;
    await q`
      insert into migration_flags (key) values (${PROJECT_HANDOFFS_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!v13bApplied) {
    // Web Push subscriptions. One row per installed browser/device push
    // endpoint; multiple devices per user are separate rows. `endpoint`
    // is globally unique. Dead endpoints (404/410 from the push service)
    // are pruned in src/lib/push.ts after a failed send.
    await q`
      create table if not exists push_subscriptions (
        id          bigserial primary key,
        user_id     integer not null references users(id) on delete cascade,
        endpoint    text not null unique,
        p256dh      text not null,
        auth        text not null,
        user_agent  text,
        created_at  timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists push_subscriptions_user_idx
        on push_subscriptions(user_id)
    `;

    // Sales "request changes" channel. A salesperson cannot edit a
    // quotation received from presales; instead they file a change
    // request that routes back to the quotation's author (target_user_id,
    // normally the owner). Status walks open → resolved.
    await q`
      create table if not exists quotation_change_requests (
        id              bigserial primary key,
        quotation_id    integer not null references quotations(id) on delete cascade,
        requested_by    integer references users(id) on delete set null,
        target_user_id  integer references users(id) on delete set null,
        note            text not null,
        status          text not null default 'open' check (status in ('open','resolved')),
        resolved_by     integer references users(id) on delete set null,
        resolved_at     timestamptz,
        created_at      timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists quotation_change_requests_q_idx
        on quotation_change_requests(quotation_id, status)
    `;
    await q`
      create index if not exists quotation_change_requests_target_idx
        on quotation_change_requests(target_user_id, status)
    `;

    // Per-file "share to projects" flag. Sales / presales flip this on a
    // project file so projects-module users who aren't the file owner can
    // read it. Default false keeps every file private to its owner until
    // explicitly shared.
    await q`
      alter table project_files
        add column if not exists shared_to_projects boolean not null default false
    `;
    await q`
      create index if not exists project_files_shared_idx
        on project_files(project_id, shared_to_projects, deleted_at)
    `;

    await q`
      insert into migration_flags (key) values (${V13B_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!v13cApplied) {
    // Execution reports. A project technician / engineer posts progress
    // updates + feedback against a project they're assigned to; the
    // project manager and project owner read them. `kind` colours the
    // entry (progress update / blocker / completion note); `progress` is
    // an optional 0-100 percent.
    await q`
      create table if not exists execution_reports (
        id          bigserial primary key,
        project_id  integer not null references projects(id) on delete cascade,
        author_id   integer references users(id) on delete set null,
        kind        text not null default 'update'
                      check (kind in ('update','blocker','done')),
        progress    integer check (progress is null or (progress >= 0 and progress <= 100)),
        body        text not null,
        created_at  timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists execution_reports_project_idx
        on execution_reports(project_id, created_at desc)
    `;
    await q`
      insert into migration_flags (key) values (${V13C_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!v13dApplied) {
    // V1.3D sales module. Sales marks the client outcome on an approved
    // quotation. `sales_outcome` is the salesperson's verdict — distinct
    // from the manager approval reject (`rejected_at`), which is about
    // sign-off, not the deal result. Held quotations stage for execution:
    // `hold_transfer_at` is an optional schedule (null = manual only) and
    // `transferred_at` records when the project handoff was actually
    // created (manually or by the lazy sweep in src/lib/holds.ts).
    await q`
      alter table quotations
        add column if not exists sales_outcome text
    `;
    await q`
      alter table quotations
        drop constraint if exists quotations_sales_outcome_check
    `;
    await q`
      alter table quotations
        add constraint quotations_sales_outcome_check
        check (sales_outcome is null
               or sales_outcome in ('accepted','rejected','held'))
    `;
    await q`
      alter table quotations
        add column if not exists sales_outcome_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists sales_outcome_by integer references users(id) on delete set null
    `;
    await q`
      alter table quotations
        add column if not exists sales_outcome_reason text
    `;
    await q`
      alter table quotations
        add column if not exists hold_transfer_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists transferred_at timestamptz
    `;
    // 1.4C — presales → sales handoff for an RFQ-anchored quotation. The
    // pair (sent_to_sales_at, sent_to_sales_by) stamps when presales
    // finished the quotation and pushed it to the salesperson who raised
    // the RFQ; (sales_accepted_at, sales_accepted_by) records the sales
    // requester accepting the proposal. Both are independent of the
    // sales_manager sign-off (`sales_approved_at` / `approved_at`) and the
    // final client outcome (`sales_outcome`) — they sit between RFQ-claim
    // and manager approval, so a manager still has the last word.
    await q`
      alter table quotations
        add column if not exists sent_to_sales_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists sent_to_sales_by integer references users(id) on delete set null
    `;
    await q`
      alter table quotations
        add column if not exists sales_accepted_at timestamptz
    `;
    await q`
      alter table quotations
        add column if not exists sales_accepted_by integer references users(id) on delete set null
    `;

    // Partial index for the hold sweep: it only ever scans held, not-yet
    // transferred rows that carry a schedule, so this stays tiny.
    await q`
      create index if not exists quotations_hold_due_idx
        on quotations(hold_transfer_at)
        where sales_outcome = 'held' and transferred_at is null
    `;

    // V1.4D — Update notes is now manual-only: the seeded release notes
    // (1.4A Sales / 1.4A Presales) were autopinned and showing up forever
    // even when admins didn't want them. Purge them once so the panel
    // starts empty; admins add announcements from the News admin panel.
    await q`
      delete from news_posts
      where title in (${"1.4A — Sales module"},
                      ${"1.4A — Presales workflow"},
                      ${"V1.3D — Sales module update"})
    `;

    await q`
      insert into migration_flags (key) values (${V13D_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!userToolsApplied) {
    // Personal Calendar Marker. One optional row per (user, day). The
    // unique constraint lets the API upsert with ON CONFLICT, and a
    // colour tag drives the dot/cell accent in the week view. `note` is
    // short free text; clearing it deletes the row API-side.
    await q`
      create table if not exists calendar_marks (
        id         bigserial primary key,
        user_id    integer not null references users(id) on delete cascade,
        mark_date  date not null,
        note       text not null default '',
        color      text not null default 'red',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (user_id, mark_date)
      )
    `;
    await q`
      create index if not exists calendar_marks_user_date_idx
        on calendar_marks(user_id, mark_date)
    `;

    // My Notes — the user's private notebook. Soft-deleted via deleted_at
    // so an accidental delete is recoverable, owner-isolated by user_id.
    await q`
      create table if not exists user_notes (
        id         bigserial primary key,
        user_id    integer not null references users(id) on delete cascade,
        title      text not null default 'Untitled note',
        body       text not null default '',
        deleted_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists user_notes_user_idx
        on user_notes(user_id, deleted_at, updated_at desc)
    `;

    await q`
      insert into migration_flags (key) values (${USER_TOOLS_FLAG})
      on conflict (key) do nothing
    `;
  }

  // ── Email integration (V1.4C+) ─────────────────────────────────────────────
  // Shared mail-server config (one row, admin-managed) + per-user mailbox
  // credentials. Passwords are stored AES-256-GCM encrypted (see emailCrypto),
  // never plaintext. Idempotent so they self-heal on every boot.
  await q`
    create table if not exists email_server_config (
      id          integer primary key default 1,
      imap_host   text not null default '',
      imap_port   integer not null default 993,
      smtp_host   text not null default '',
      smtp_port   integer not null default 465,
      encryption  text not null default 'ssl_tls',
      updated_at  timestamptz not null default now(),
      updated_by  integer references users(id) on delete set null,
      constraint email_server_config_singleton check (id = 1)
    )
  `;
  await q`
    create table if not exists user_email_accounts (
      user_id         integer primary key references users(id) on delete cascade,
      email_address   text not null,
      username        text not null,
      password_enc    text not null,
      enabled         boolean not null default true,
      last_test_ok    boolean,
      last_tested_at  timestamptz,
      last_test_error text,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    )
  `;

  if (!v14aApplied) {
    // V1.4D — Update notes is manual-only. Remove the auto-seeded 1.4A
    // notes if they're still around so the panel doesn't keep showing
    // stale release announcements forever; admins add news from the
    // News admin panel.
    await q`
      delete from news_posts
      where title in (${"1.4A — Sales module"},
                      ${"1.4A — Presales workflow"},
                      ${"V1.3D — Sales module update"})
    `;

    await q`
      insert into migration_flags (key) values (${V14A_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!leadSharedQueueApplied) {
    // Move pre-1.4A leads onto the shared-queue lifecycle. A lead that was
    // 'distributed' (manager-assigned) is now 'in_progress' (claimed) — the
    // assignee is already recorded in assigned_to_id, so this is a pure
    // status rename. Untouched: 'new' leads stay 'new' (unclaimed).
    await q`update leads set status = 'in_progress' where status = 'distributed'`;

    await q`
      insert into migration_flags (key) values (${LEAD_SHARED_QUEUE_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!projectTasksApplied) {
    // Per-project technician to-do checklist. Assigned members tick items
    // off during execution; the PM reads progress on the project page (and
    // it can roll up into the project's completion %).
    await q`
      create table if not exists project_tasks (
        id          bigserial primary key,
        project_id  integer not null references projects(id) on delete cascade,
        title       text not null,
        done        boolean not null default false,
        position    integer not null default 0,
        created_by  integer references users(id) on delete set null,
        done_by     integer references users(id) on delete set null,
        done_at     timestamptz,
        created_at  timestamptz not null default now(),
        deleted_at  timestamptz
      )
    `;
    await q`
      create index if not exists project_tasks_project_idx
        on project_tasks(project_id) where deleted_at is null
    `;
    await q`
      insert into migration_flags (key) values (${PROJECT_TASKS_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!productBarcodeApplied) {
    // Barcode / QR payload per product so the storage team can scan an item
    // to record a stock movement instead of searching for it.
    await q`alter table products add column if not exists barcode text`;
    await q`
      create index if not exists products_barcode_idx
        on products(barcode) where barcode is not null
    `;
    await q`
      insert into migration_flags (key) values (${PRODUCT_BARCODE_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!orphanFolderCleanupApplied) {
    // One-time cleanup of orphaned 'company'-kind client folders: a folder
    // tagged as a company client whose company has been deleted (or was never
    // linked) used to survive as an active "client folder" sitting under
    // "0 companies". Soft-delete those folders — and any projects filed under
    // them — so they land in Trash like a normal removal. Going forward, the
    // trash purge of a company also removes its folders, so this won't recur.
    await q`
      update projects set deleted_at = now(), updated_at = now()
      where deleted_at is null
        and folder_id in (
          select cf.id from client_folders cf
          where cf.deleted_at is null and cf.kind = 'company'
            and not exists (
              select 1 from companies c
              where c.id = cf.company_id and c.deleted_at is null
            )
        )
    `;
    await q`
      update client_folders cf set deleted_at = now(), updated_at = now()
      where cf.deleted_at is null and cf.kind = 'company'
        and not exists (
          select 1 from companies c
          where c.id = cf.company_id and c.deleted_at is null
        )
    `;
    await q`
      insert into migration_flags (key) values (${ORPHAN_FOLDER_CLEANUP_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!installationRatesApplied) {
    // Installation calculator rate book. One flexible table holds every
    // priced input the calculator combines: conduit & cable (per metre),
    // labour (engineer/technician per day), location/region uplift, and misc
    // accessories. `unit` tells the calculator how to apply unit_cost
    // (meter | day | piece | percent | fixed).
    await q`
      create table if not exists installation_rates (
        id         bigserial primary key,
        category   text not null
                     check (category in ('conduit','cable','labor','location','accessory')),
        name       text not null,
        unit       text not null default 'meter'
                     check (unit in ('meter','day','piece','percent','fixed')),
        unit_cost  numeric not null default 0,
        sort       integer not null default 0,
        active     boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;
    await q`
      create index if not exists installation_rates_cat_idx
        on installation_rates(category, sort) where active
    `;
    // Seed the rows the user named so the admin opens to a usable structure.
    // Only when empty, so re-running never duplicates.
    const seeded = (await q`select 1 from installation_rates limit 1`) as Array<{
      "?column?": number;
    }>;
    if (seeded.length === 0) {
      await q`
        insert into installation_rates (category, name, unit, unit_cost, sort) values
          ('labor', 'Engineer', 'day', 0, 0),
          ('labor', 'Technician', 'day', 0, 1),
          ('location', 'Middle', 'percent', 0, 0),
          ('location', 'North', 'percent', 0, 1),
          ('location', 'South', 'percent', 0, 2)
      `;
    }
    await q`
      insert into migration_flags (key) values (${INSTALLATION_RATES_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!leadsSalesProjectApplied) {
    // The project a salesperson raised an RFQ from. When presales claim & file
    // the lead they overwrite leads.project_id with their OWN project, severing
    // the link back to the sales project. This column preserves the original
    // so the sales project can still surface the resulting quotation. Backfill
    // existing rows with the current project_id (best-effort).
    await q`alter table leads add column if not exists sales_project_id integer`;
    // Backfill: recover the ORIGINAL sales project from the claim event log
    // (assign-and-claim records previous_project_id when it overwrites
    // project_id). Falls back to the current project_id when there's no such
    // event (e.g. leads that were never re-filed).
    await q`
      update leads l set sales_project_id = coalesce(
        (
          select (e.meta_json->>'previous_project_id')::int
          from lead_events e
          where e.lead_id = l.id
            and e.meta_json->>'previous_project_id' is not null
          order by e.created_at asc
          limit 1
        ),
        l.project_id
      )
      where l.sales_project_id is null
    `;
    await q`
      create index if not exists leads_sales_project_idx on leads(sales_project_id)
    `;
    await q`
      insert into migration_flags (key) values (${LEADS_SALES_PROJECT_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!multitenancyApplied) {
    // Each user belongs to one tenant (company). A single default tenant is
    // seeded and every existing user is backfilled into it, so an existing
    // single-company deployment keeps behaving exactly as before. Per-feature
    // isolation is layered on top by scoping "see all" reads to the requester's
    // tenant (see getTenantUserIds in src/lib/scope.ts). Additive + idempotent.
    await q`
      create table if not exists tenants (
        id         serial primary key,
        name       text not null,
        slug       text unique,
        plan       text not null default 'trial',
        created_at timestamptz not null default now()
      )
    `;
    await q`
      insert into tenants (name, slug)
      values ('MagicTech', 'magictech')
      on conflict (slug) do nothing
    `;
    await q`
      alter table users add column if not exists tenant_id integer references tenants(id)
    `;
    // Backfill any user without a tenant into the default tenant. Runs every
    // boot, so a freshly-seeded admin or a row that slipped through self-heals.
    await q`
      update users set tenant_id = (select id from tenants where slug = 'magictech')
      where tenant_id is null
    `;
    await q`
      create index if not exists users_tenant_idx on users(tenant_id)
    `;
    // jsonb normalization helpers. items_json / totals_json are written via
    // `${JSON.stringify(x)}::jsonb`, which the postgres driver stores as a jsonb
    // *scalar string* (the array/object JSON wrapped one extra level), not a
    // real jsonb array/object — so `totals_json->>'total'` is NULL and
    // `jsonb_array_elements(items_json)` can't read it. The app's JS readers
    // already JSON.parse defensively; these functions give SQL the same
    // tolerance, accepting BOTH the double-encoded string form and a proper
    // array/object. Used by the pipeline-board queries.
    await q`
      create or replace function jsonb_as_array(j jsonb) returns jsonb
      language sql immutable as $$
        select case
          when jsonb_typeof(j) = 'array' then j
          when jsonb_typeof(j) = 'string' and left(j #>> '{}', 1) = '['
            then (j #>> '{}')::jsonb
          else '[]'::jsonb
        end
      $$
    `;
    await q`
      create or replace function jsonb_as_object(j jsonb) returns jsonb
      language sql immutable as $$
        select case
          when jsonb_typeof(j) = 'object' then j
          when jsonb_typeof(j) = 'string' and left(j #>> '{}', 1) = '{'
            then (j #>> '{}')::jsonb
          else '{}'::jsonb
        end
      $$
    `;
    await q`
      insert into migration_flags (key) values (${MULTITENANCY_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!departmentCodeApplied) {
    // Per-user department code (e.g. "ITD1") assigned by an admin. It forms the
    // leading segment of every auto-generated quotation reference
    // (<DEPT>-FO<YY>-<HEX>). Empty until an admin assigns one. Additive, so
    // databases that predate this column gain it here.
    await q`alter table users add column if not exists department_code text not null default ''`;
    await q`
      insert into migration_flags (key) values (${DEPARTMENT_CODE_FLAG})
      on conflict (key) do nothing
    `;
  }

  if (!sequenceRealignApplied) {
    // Self-heal drifted identity sequences. A prior data restore (D1→Postgres
    // import / backup restore) inserted rows with explicit IDs but did not
    // advance the owning sequence, so the next `nextval` returned an id that
    // already existed. The first auto-id insert into such a table then failed
    // with `duplicate key value violates unique constraint "<table>_pkey"` —
    // which is exactly what blocked assign-role's activity_log audit write and
    // made role assignment look broken in the admin panel.
    //
    // For every integer column backed by a sequence, bump the sequence to
    // max(col)+1 so the next insert can't collide with a restored row. Mirrors
    // the realignSequences helper used by the backup-restore path. Best-effort
    // per column; a single failure must not abort the whole bootstrap.
    const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
    try {
      const seqCols = (await q`
        select c.table_name, c.column_name,
               pg_get_serial_sequence(quote_ident(c.table_name), c.column_name) as seq
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.data_type in ('integer', 'bigint', 'smallint')
      `) as Array<{ table_name: string; column_name: string; seq: string | null }>;
      for (const sc of seqCols) {
        if (!sc.seq) continue;
        try {
          await q.unsafe(
            `select setval($1::regclass,
               coalesce((select max(${quoteIdent(sc.column_name)})
                         from ${quoteIdent(sc.table_name)}), 0) + 1, false)`,
            [sc.seq],
          );
        } catch {
          // Column may not actually own the sequence, or the table is
          // unreadable — skip it; the others still get realigned.
        }
      }
    } catch {
      // Catalogue query failed — non-fatal; the audit-log inserts are also
      // wrapped defensively so a still-drifted sequence can't block writes.
    }

    await q`
      insert into migration_flags (key) values (${SEQUENCE_REALIGN_FLAG})
      on conflict (key) do nothing
    `;
  }

  // Executive-manager confirmation. Presales / presales managers submit a
  // finished quotation (with pricing) or a pricing sheet to the executive
  // manager, who confirms or rejects it. `exec_status` walks
  // 'none' → 'pending' → 'confirmed' | 'rejected'; the submit stamps
  // exec_submitted_*, the decision stamps exec_decided_* (+ a reason on
  // reject). The same six columns live on both `quotations` and
  // `pricing_projects` so one workflow drives both artifact types. Top-level
  // (not nested in another flag gate) so an existing database picks the
  // columns up exactly once.
  if (!execConfirmationApplied) {
    for (const t of ["quotations", "pricing_projects"] as const) {
      await q.unsafe(
        `alter table ${t} add column if not exists exec_status text not null default 'none'`,
      );
      await q.unsafe(
        `alter table ${t} add column if not exists exec_submitted_at timestamptz`,
      );
      await q.unsafe(
        `alter table ${t} add column if not exists exec_submitted_by integer references users(id) on delete set null`,
      );
      await q.unsafe(
        `alter table ${t} add column if not exists exec_decided_at timestamptz`,
      );
      await q.unsafe(
        `alter table ${t} add column if not exists exec_decided_by integer references users(id) on delete set null`,
      );
      await q.unsafe(
        `alter table ${t} add column if not exists exec_reject_reason text`,
      );
    }
    await q`
      create index if not exists quotations_exec_status_idx
        on quotations(exec_status) where exec_status <> 'none'
    `;
    await q`
      create index if not exists pricing_projects_exec_status_idx
        on pricing_projects(exec_status) where exec_status <> 'none'
    `;
    await q`
      insert into migration_flags (key) values (${EXEC_CONFIRMATION_FLAG})
      on conflict (key) do nothing
    `;
  }

  // Project distribution — a project manager's "work order" that hands a
  // project to a technician / engineer. A distribution IS an enriched
  // project_assignment (so creating one also grants the assignee access):
  // location, start_date, end_date and notes already exist, so this only adds
  // the scope of work, an execution status, and client context
  // (company / client / contact / email) snapshotted from the folder but kept
  // freely editable.
  if (!projectDistributionApplied) {
    await q.unsafe(
      `alter table project_assignments add column if not exists scope_of_work text`,
    );
    await q.unsafe(
      `alter table project_assignments add column if not exists status text not null default 'assigned'`,
    );
    await q.unsafe(
      `alter table project_assignments add column if not exists company_name text`,
    );
    await q.unsafe(
      `alter table project_assignments add column if not exists client_name text`,
    );
    await q.unsafe(
      `alter table project_assignments add column if not exists contact_name text`,
    );
    await q.unsafe(
      `alter table project_assignments add column if not exists contact_email text`,
    );
    await q`
      insert into migration_flags (key) values (${PROJECT_DISTRIBUTION_FLAG})
      on conflict (key) do nothing
    `;
  }

  // Per-manufacturer pricing defaults. A pricing manufacturer can carry default
  // shipping / customs / profit rates (stored as decimals, e.g. 0.35 = 35%)
  // that seed the constants of every new pricing sheet under it. NULL means
  // "fall back to the global default constants".
  if (!pricingMfgDefaultsApplied) {
    await q.unsafe(
      `alter table pricing_manufacturers add column if not exists default_shipping_rate numeric`,
    );
    await q.unsafe(
      `alter table pricing_manufacturers add column if not exists default_customs_rate numeric`,
    );
    await q.unsafe(
      `alter table pricing_manufacturers add column if not exists default_profit_margin numeric`,
    );
    await q`
      insert into migration_flags (key) values (${PRICING_MFG_DEFAULTS_FLAG})
      on conflict (key) do nothing
    `;
  }
}

/**
 * Seed the release-notes changelog (src/lib/releaseNotes.ts) into `news_posts`
 * so the Product-updates feed always reflects the shipped version.
 *
 * Runs once per process AFTER `_ensureSchemaOnce` (so `news_posts` exists),
 * and crucially OUTSIDE its "all migrations applied — nothing to do" early
 * return, so the changelog still seeds on warm/already-bootstrapped databases.
 * It is NOT gated by a migration flag and is idempotent by title, so adding a
 * note in releaseNotes.ts surfaces it on the next cold start with no
 * fingerprint bump. `created_by` is null (a system post) and the `all`
 * audience makes it visible to every role.
 */
async function _seedReleaseNotes(): Promise<void> {
  const q = sql();
  for (const note of RELEASE_NOTES) {
    await q`
      insert into news_posts
        (title, body, audience_modules, audience_roles, pinned, created_by, created_at)
      select ${note.title}, ${note.body},
             ${note.audience_modules}::text[], ${note.audience_roles}::text[],
             ${note.pinned}, null, ${note.date}::timestamptz
      where not exists (
        select 1 from news_posts where title = ${note.title}
      )
    `;
  }
}
