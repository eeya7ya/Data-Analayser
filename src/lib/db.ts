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

/** One-shot schema bootstrap. Idempotent — safe to run on every cold start. */
export async function ensureSchema(): Promise<void> {
  const q = sql();
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

  // ── Catalogue tables ──────────────────────────────────────────────────────
  //
  // The product catalogue moved from static GitHub JSON files to Postgres so
  // admins can upload Excel sheets to update prices (4x/year), add new SKUs,
  // and soft-delete discontinued items. Every non-normalized field from the
  // legacy JSONs lives in the `specs` JSONB column, lossless — see
  // scripts/seed-catalogue.mjs. Unique key is (vendor, category, model) because
  // HIKVISION has overlapping model strings between its MIXED/ and IP Cameera/
  // files; a narrower key would silently collapse them.
  await q`
    create table if not exists catalogue_items (
      id                 serial primary key,
      vendor             text not null,
      category           text not null default '',
      sub_category       text default '',
      model              text not null,
      description        text not null default '',
      description_locked boolean not null default false,
      currency           text not null default 'USD',
      price_dpp          numeric,
      price_si           numeric,
      price_end_user     numeric,
      specs              jsonb not null default '{}'::jsonb,
      active             boolean not null default true,
      created_at         timestamptz not null default now(),
      updated_at         timestamptz not null default now(),
      unique (vendor, category, model)
    )
  `;
  await q`create index if not exists catalogue_vendor_idx   on catalogue_items(vendor)`;
  await q`create index if not exists catalogue_category_idx on catalogue_items(vendor, category)`;
  await q`create index if not exists catalogue_active_idx   on catalogue_items(active)`;

  await q`
    create table if not exists catalogue_price_history (
      id             serial primary key,
      item_id        integer not null references catalogue_items(id) on delete cascade,
      price_dpp      numeric,
      price_si       numeric,
      price_end_user numeric,
      changed_by     integer references users(id) on delete set null,
      changed_at     timestamptz not null default now(),
      source         text not null default 'manual'
    )
  `;
  await q`
    create index if not exists catalogue_price_history_item_idx
      on catalogue_price_history(item_id, changed_at desc)
  `;

  // Audit trigger — every write path (PATCH, Excel commit, SQL console)
  // gets a history row for free. The caller sets the `source` with
  // `sql\`set local app.price_source = 'excel'\`` before the update.
  await q`
    create or replace function log_catalogue_price_change() returns trigger as $$
    begin
      if new.price_dpp is distinct from old.price_dpp
         or new.price_si is distinct from old.price_si
         or new.price_end_user is distinct from old.price_end_user then
        insert into catalogue_price_history(item_id, price_dpp, price_si, price_end_user, source)
        values (old.id, old.price_dpp, old.price_si, old.price_end_user,
                coalesce(current_setting('app.price_source', true), 'manual'));
      end if;
      new.updated_at := now();
      return new;
    end;
    $$ language plpgsql
  `;
  await q`drop trigger if exists catalogue_price_history_trg on catalogue_items`;
  await q`
    create trigger catalogue_price_history_trg
      before update on catalogue_items
      for each row execute function log_catalogue_price_change()
  `;

  // Selection theory (used by /api/groq/design) — one row per vendor/category.
  await q`
    create table if not exists catalogue_theory (
      id         serial primary key,
      vendor     text not null,
      category   text not null default '',
      payload    jsonb not null,
      updated_at timestamptz not null default now(),
      unique (vendor, category)
    )
  `;

  // Async job rows for the Regenerate Descriptions bulk action. Client polls
  // /api/admin/catalogue/jobs/:id to watch progress; the worker runs inside
  // next/server `after()` so it survives past the HTTP response.
  await q`
    create table if not exists catalogue_jobs (
      id         serial primary key,
      kind       text not null,
      status     text not null default 'pending',
      total      integer not null default 0,
      done       integer not null default 0,
      error      text,
      payload    jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
}
