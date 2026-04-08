import { neon } from "@neondatabase/serverless";

// Note: Neon serverless ≥0.10 always caches connections; no config needed.

function getUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Set it in your Vercel project env (Neon / Vercel Postgres).",
    );
  }
  return url;
}

/**
 * Returns a Neon SQL tagged-template client. Safe to call from any route.
 * Usage: `const rows = await sql\`select * from users\`;`
 */
export function sql() {
  return neon(getUrl());
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
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now()
    )
  `;
  await q`
    create index if not exists quotations_owner_idx on quotations(owner_id)
  `;
}
