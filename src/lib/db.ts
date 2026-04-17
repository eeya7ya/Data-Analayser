import postgres, { type Sql } from "postgres";

/**
 * Supabase Postgres client for Vercel serverless runtimes.
 *
 * The connection URL should point at the Supabase **Transaction Pooler**
 * (Supavisor) on port `6543` — e.g.:
 *
 *   postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
 *
 * Transaction mode is required for serverless because each function
 * invocation briefly checks out a pooled connection. This mode does NOT
 * support server-side prepared statements, so `prepare: false` is mandatory.
 *
 * Env var resolution order (first non-empty wins):
 *   1. DATABASE_URL            — manual setup (our docs).
 *   2. POSTGRES_URL            — injected by the Supabase→Vercel native
 *                                integration; points at the pooled endpoint.
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

function getUrl(): string {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;
  if (!url) {
    throw new Error(
      "No Supabase connection string found. Expected one of DATABASE_URL, " +
        "POSTGRES_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL_NON_POOLING in " +
        "the Vercel project env (Project Settings → Environment Variables). " +
        "The Supabase→Vercel integration normally injects POSTGRES_URL " +
        "automatically; redeploy after linking it.",
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
export function sql(): Sql {
  if (!globalForDb.__mtSql) {
    globalForDb.__mtSql = postgres(getUrl(), {
      // Supabase requires TLS for every connection.
      ssl: "require",
      // Required for Supabase Transaction Pooler (pgbouncer-in-transaction-mode)
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
 * Supabase round-trip. Running them on every Vercel cold start was adding
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
 *   Q<L><DDMMYY>MT<n>[R<m> | D<m>]
 *
 * where L is the owner's first-letter initial, n is the per-user counter
 * of "active" quotations they've created, and m is the per-parent counter
 * of reviews/drafts anchored to that original record.
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

/** One-shot schema bootstrap. Idempotent — safe to run on every cold start. */
export async function ensureSchema(): Promise<void> {
  if (globalForSchema.__mtSchemaPromise) return globalForSchema.__mtSchemaPromise;
  globalForSchema.__mtSchemaPromise = _ensureSchemaOnce();
  return globalForSchema.__mtSchemaPromise;
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
      ${CRM_SEARCH_FLAG}, ${PERF_INDEX_V2_FLAG}, ${QUOTATION_CONTACT_FLAG}
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
  try {
    const rows = (await q`
      select key from migration_flags
      where key in (
        ${SCHEMA_FINGERPRINT}, ${PERF_INDEX_FLAG}, ${QUOTATION_STATUS_FLAG},
        ${CRM_FOUNDATION_FLAG}, ${CRM_CONTACTS_FLAG}, ${CRM_DEALS_FLAG},
        ${CRM_TASKS_FLAG}, ${CRM_WORKFLOWS_FLAG}, ${CRM_TEAMS_FLAG},
        ${CRM_SEARCH_FLAG}, ${PERF_INDEX_V2_FLAG}, ${QUOTATION_CONTACT_FLAG}
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
    quotationContactApplied
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
  // taken from, so every draft/review of QA140426MT5 shares the anchor
  // "QA140426MT5" regardless of whether the user re-drafted from a previous
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
}
