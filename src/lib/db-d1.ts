/**
 * Cloudflare D1 client with two interchangeable transports.
 *
 * 1. Native binding (preferred) — when the app runs on Cloudflare Workers,
 *    `env.magictech` (see wrangler.toml) is a real D1 binding. Queries go
 *    straight to the database with no HTTP round-trip, and `d1Batch` gets
 *    genuine transactional atomicity.
 *
 * 2. REST API (fallback) — used anywhere the binding doesn't exist: local
 *    `next dev`, one-off admin scripts, or a non-Workers host. This is the
 *    path the app used while it was still deployed on Vercel, where
 *    Cloudflare bindings aren't available, and it's kept so those
 *    environments keep working unchanged.
 *
 * `getBinding()` decides per call, so the same code works in both places and
 * callers never need to know which transport is live. The public surface
 * (`d1Query`, `d1Exec`, `d1Batch`) is identical either way.
 *
 * Env vars — only needed for the REST fallback (on Workers the binding
 * supplies everything and none of these have to be set):
 *
 *   CLOUDFLARE_ACCOUNT_ID    — your account ID from the dashboard URL
 *   CLOUDFLARE_D1_DATABASE_ID — 385c686f-31a1-46cb-b2ee-a919472ad978
 *                              (from wrangler.toml)
 *   CLOUDFLARE_API_TOKEN     — a custom token with the "D1 Edit" perm
 *                              (dashboard → My Profile → API Tokens)
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

const ENDPOINT_BASE = "https://api.cloudflare.com/client/v4/accounts";

/** Binding name declared in wrangler.toml → [[d1_databases]]. */
const D1_BINDING = "magictech";

/**
 * Minimal structural shape of a D1 binding. Declared locally rather than
 * pulling in `@cloudflare/workers-types`, which would fight with the Node
 * types the rest of the app is compiled against.
 */
type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T>(): Promise<{
    results?: T[];
    success?: boolean;
    meta?: D1QueryResult["meta"];
  }>;
};

type D1Binding = {
  prepare(sql: string): D1PreparedStatement;
  batch(
    statements: D1PreparedStatement[],
  ): Promise<
    Array<{ results?: unknown[]; success?: boolean; meta?: D1QueryResult["meta"] }>
  >;
};

/**
 * The native D1 binding when running on Workers, otherwise null.
 *
 * `getCloudflareContext()` throws when there's no Workers context (plain
 * `next dev`, `next build` prerendering, node scripts), so the throw is the
 * signal to fall back to REST rather than an error worth surfacing.
 */
function getBinding(): D1Binding | null {
  try {
    const env = getCloudflareContext().env as unknown as
      | Record<string, unknown>
      | undefined;
    const db = env?.[D1_BINDING];
    if (db && typeof (db as D1Binding).prepare === "function") {
      return db as D1Binding;
    }
    return null;
  } catch {
    return null;
  }
}

/** Bind params only when there are some — `.bind()` with no args is an error. */
function prepared(
  binding: D1Binding,
  sql: string,
  params: Array<string | number | null>,
): D1PreparedStatement {
  const stmt = binding.prepare(sql);
  return params.length > 0 ? stmt.bind(...params) : stmt;
}

type D1QueryResult<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  meta?: {
    duration?: number;
    rows_read?: number;
    rows_written?: number;
    last_row_id?: number;
    changes?: number;
  };
};

type D1ApiEnvelope<T> = {
  result: T[];
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
};

function readConfig(): {
  accountId: string;
  databaseId: string;
  token: string;
} {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !token) {
    throw new Error(
      "D1 is not configured. Set CLOUDFLARE_ACCOUNT_ID, " +
        "CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN in Vercel " +
        "Project Settings → Environment Variables.",
    );
  }
  return { accountId, databaseId, token };
}

/**
 * Whether D1 is reachable for this deployment — either through the native
 * Workers binding or through a fully-configured REST fallback. Used by
 * feature-flag checks so an unconfigured environment degrades silently
 * instead of crashing.
 */
export function isD1Configured(): boolean {
  // On Workers the binding is all that's needed; the REST env vars are not.
  if (getBinding()) return true;
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_D1_DATABASE_ID &&
      process.env.CLOUDFLARE_API_TOKEN,
  );
}

/**
 * Run a single parameterized SQL statement against D1 and return the
 * rows. Parameters are positional `?` placeholders. Statements that don't
 * return rows (INSERT / UPDATE / DELETE / DDL) come back with an empty
 * `results` array; the meta fields are still populated.
 *
 * Example:
 *   const rows = await d1Query<{ id: number; name: string }>(
 *     "SELECT id, name FROM users WHERE role = ?",
 *     ["admin"],
 *   );
 */
export async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: Array<string | number | null> = [],
): Promise<D1QueryResult<T>> {
  // Preferred path: native binding, no HTTP hop.
  const binding = getBinding();
  if (binding) {
    const r = await prepared(binding, sql, params).all<T>();
    return {
      results: r.results ?? [],
      success: r.success !== false,
      meta: r.meta,
    };
  }

  const { accountId, databaseId, token } = readConfig();
  const url = `${ENDPOINT_BASE}/${accountId}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const env = (await res.json()) as D1ApiEnvelope<D1QueryResult<T>>;
  if (!env.success) {
    const msg = env.errors?.map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`D1 API error: ${msg || "unknown"}`);
  }
  // The REST API returns an array even for single statements.
  const first = env.result?.[0];
  if (!first) {
    return { results: [], success: true };
  }
  return first;
}

/**
 * Run multiple statements as a single batch, in order. Use this for bulk
 * INSERTs during data load so partial loads don't leave the destination in
 * an in-between state.
 *
 * Atomicity depends on the transport:
 *
 *   • Native binding — `batch()` wraps the statements in a real transaction.
 *     If any statement fails the whole batch rolls back. This is the path
 *     taken on Workers.
 *
 *   • REST fallback — the `/query` endpoint has no batch mode, so statements
 *     are executed one at a time and a mid-batch failure leaves earlier rows
 *     committed. Safe enough for the INSERT-only workloads that use it (rows
 *     stay individually valid and the caller can retry), but it is NOT a
 *     transaction. Prefer running bulk loads on Workers now that the binding
 *     is available.
 */
export async function d1Batch(
  statements: Array<{ sql: string; params?: Array<string | number | null> }>,
): Promise<D1QueryResult[]> {
  if (statements.length === 0) return [];

  const binding = getBinding();
  if (binding) {
    const res = await binding.batch(
      statements.map((s) => prepared(binding, s.sql, s.params ?? [])),
    );
    return res.map((r) => ({
      results: (r.results ?? []) as Array<Record<string, unknown>>,
      success: r.success !== false,
      meta: r.meta,
    }));
  }

  const results: D1QueryResult[] = [];
  for (const stmt of statements) {
    const result = await d1Query(stmt.sql, stmt.params);
    results.push(result);
  }
  return results;
}

/**
 * Shortcut for fire-and-forget statements where the caller doesn't care
 * about the returned rows (DDL, single UPDATE, etc.). Returns the meta
 * row so callers can still inspect `changes` / `last_row_id` if needed.
 */
export async function d1Exec(
  sql: string,
  params: Array<string | number | null> = [],
): Promise<D1QueryResult["meta"]> {
  const r = await d1Query(sql, params);
  return r.meta;
}
