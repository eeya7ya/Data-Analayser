#!/usr/bin/env node
/**
 * Bootstraps the Supabase Postgres schema and the default admin user.
 *
 * Usage:
 *   DATABASE_URL=postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres \
 *   node scripts/init-db.mjs
 *
 * The Supabase Transaction Pooler (port 6543) is the recommended connection
 * target for serverless deployments (Vercel, etc.) and is used by the app
 * at runtime.
 */
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error(
    "No Supabase connection string found. Set DATABASE_URL (or POSTGRES_URL " +
      "from the Supabase→Vercel integration). Copy it from Supabase → " +
      "Project Settings → Database → Connection string → Transaction pooler.",
  );
  process.exit(1);
}

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

const ITERS = 120_000;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERS },
    key,
    256,
  );
  const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");
  return `pbkdf2$${ITERS}$${b64(salt.buffer)}$${b64(bits)}`;
}

async function main() {
  await sql`
    create table if not exists users (
      id            serial primary key,
      username      text unique not null,
      password_hash text not null,
      role          text not null default 'user',
      created_at    timestamptz not null default now()
    )
  `;
  await sql`
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
  await sql`
    alter table quotations add column if not exists config_json jsonb not null default '{}'::jsonb
  `;
  await sql`create index if not exists quotations_owner_idx on quotations(owner_id)`;

  const adminUser = process.env.DEFAULT_ADMIN_USER || "admin";
  const adminPass = process.env.DEFAULT_ADMIN_PASS || "admin123";
  const rows = await sql`select id from users where username = ${adminUser}`;
  if (rows.length === 0) {
    const hash = await hashPassword(adminPass);
    await sql`
      insert into users (username, password_hash, role)
      values (${adminUser}, ${hash}, 'admin')
    `;
    console.log(`Created default admin: ${adminUser} / ${adminPass}`);
    console.log(
      "⚠  Change this password immediately from the /admin page after first login.",
    );
  } else {
    console.log(`Admin user '${adminUser}' already exists.`);
  }

  console.log("Supabase schema ready.");
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
