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
      // Serverless functions are short-lived — keep the local pool tiny so we
      // don't exhaust the shared Supavisor connection budget.
      max: 1,
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
    where key in (${SCHEMA_FINGERPRINT}, ${PERF_INDEX_FLAG}, ${QUOTATION_STATUS_FLAG})
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
  try {
    const rows = (await q`
      select key from migration_flags
      where key in (${SCHEMA_FINGERPRINT}, ${PERF_INDEX_FLAG}, ${QUOTATION_STATUS_FLAG})
    `) as Array<{ key: string }>;
    const keys = new Set(rows.map((r) => r.key));
    schemaBootstrapped = keys.has(SCHEMA_FINGERPRINT);
    perfIndexesApplied = keys.has(PERF_INDEX_FLAG);
    quotationStatusApplied = keys.has(QUOTATION_STATUS_FLAG);
  } catch {
    // migration_flags missing or unreadable — run the full DDL below.
  }

  // All migrations already applied — nothing to do.
  if (schemaBootstrapped && perfIndexesApplied && quotationStatusApplied) return;

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
}
