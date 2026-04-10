#!/usr/bin/env node
/**
 * One-shot schema migration for the catalogue tables.
 *
 * Creates `catalogue_items`, `catalogue_price_history` (with BEFORE UPDATE
 * trigger), `catalogue_theory`, and `catalogue_jobs`. Safe to re-run — every
 * DDL statement is idempotent (`create table if not exists`,
 * `create or replace function`, `drop trigger if exists`).
 *
 * Usage:
 *   DATABASE_URL=<pooler url>  node scripts/migrate-catalogue.mjs
 *
 * Run this once per environment (local dev, staging, production) after
 * pulling this branch. The app also invokes the same DDL from
 * `src/lib/db.ts:ensureSchema()` on cold starts, but running the script
 * explicitly gives a clean log and avoids paying the bootstrap cost on the
 * first admin request after deploy.
 */
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!url) {
  console.error(
    "No Supabase connection string found. Set DATABASE_URL or POSTGRES_URL.",
  );
  process.exit(1);
}

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
});

async function main() {
  console.log("→ creating catalogue_items");
  await sql`
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
  await sql`create index if not exists catalogue_vendor_idx   on catalogue_items(vendor)`;
  await sql`create index if not exists catalogue_category_idx on catalogue_items(vendor, category)`;
  await sql`create index if not exists catalogue_active_idx   on catalogue_items(active)`;

  console.log("→ creating catalogue_price_history");
  await sql`
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
  await sql`
    create index if not exists catalogue_price_history_item_idx
      on catalogue_price_history(item_id, changed_at desc)
  `;

  console.log("→ creating price-change trigger");
  await sql`
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
  await sql`drop trigger if exists catalogue_price_history_trg on catalogue_items`;
  await sql`
    create trigger catalogue_price_history_trg
      before update on catalogue_items
      for each row execute function log_catalogue_price_change()
  `;

  console.log("→ creating catalogue_theory");
  await sql`
    create table if not exists catalogue_theory (
      id         serial primary key,
      vendor     text not null,
      category   text not null default '',
      payload    jsonb not null,
      updated_at timestamptz not null default now(),
      unique (vendor, category)
    )
  `;

  console.log("→ creating catalogue_jobs");
  await sql`
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

  console.log("✓ catalogue schema ready");
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error(err);
    try {
      await sql.end({ timeout: 5 });
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
