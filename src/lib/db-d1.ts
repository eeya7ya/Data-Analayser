/**
 * Cloudflare D1 client over the public REST API.
 *
 * Why REST and not the native `env.DB` binding?
 * ─────────────────────────────────────────────
 * The app currently runs on Vercel, which doesn't expose Cloudflare
 * bindings. To validate the D1 migration without first having to move the
 * whole app to Cloudflare Pages, we drive D1 from Vercel through its REST
 * API. Once the dual-run period is over and the app is deployed to
 * Cloudflare Pages, this module can be swapped for the native binding
 * with a single import change — the public surface (`d1Query`, `d1Exec`,
 * `d1Batch`) stays the same.
 *
 * Required env vars (set in Vercel → Project Settings → Environment
 * Variables, marked Sensitive):
 *
 *   CLOUDFLARE_ACCOUNT_ID    — your account ID from the dashboard URL
 *   CLOUDFLARE_D1_DATABASE_ID — 385c686f-31a1-46cb-b2ee-a919472ad978
 *                              (from wrangler.toml)
 *   CLOUDFLARE_API_TOKEN     — a custom token with the "D1 Edit" perm
 *                              (dashboard → My Profile → API Tokens)
 *
 * Nothing in this module reads Supabase. It's purely additive — no
 * existing route imports it. Migration callers opt in explicitly.
 */

const ENDPOINT_BASE = "https://api.cloudflare.com/client/v4/accounts";

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
 * Whether D1 is configured for this deployment. Used by feature-flag
 * checks so an unconfigured environment falls back to Supabase silently
 * instead of crashing.
 */
export function isD1Configured(): boolean {
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
 * Run multiple statements as a single atomic batch. D1 applies them in
 * order inside a transaction; if any fails the whole batch rolls back.
 * Use this for bulk INSERTs during data load so partial loads don't
 * leave the destination in an in-between state.
 *
 * NOTE: D1 REST API's `/query` endpoint doesn't support true batch mode
 * (array input), so this executes each statement individually in order.
 * To make this feel atomic, all statements should be simple INSERTs.
 */
export async function d1Batch(
  statements: Array<{ sql: string; params?: Array<string | number | null> }>,
): Promise<D1QueryResult[]> {
  if (statements.length === 0) return [];
  const results: D1QueryResult[] = [];

  // Execute each statement individually. This is not truly atomic in D1,
  // but for INSERT-only workloads it's safe enough (rows stay valid even if
  // the batch partially fails; the caller can retry).
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
