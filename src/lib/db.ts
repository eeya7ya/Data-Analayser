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
}
