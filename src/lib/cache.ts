/**
 * In-process TTL cache + request coalescing for hot-read endpoints.
 *
 * Two guarantees that matter for performance on Vercel + Supabase:
 *
 *   1. **Coalescing** — concurrent callers that ask for the same key while
 *      a loader is already in flight share the same Promise. This is what
 *      stops dashboard-refresh thundering-herds from each opening their own
 *      Supabase pooler slot and timing out.
 *
 *   2. **TTL** — a successful result is kept in memory for `ttlMs`. On warm
 *      serverless instances repeat requests return instantly; no DB round
 *      trip at all. Failures are NOT cached (so retries re-run the loader).
 *
 * The cache is per-process (module scope, pinned to `globalThis` so Next.js
 * HMR doesn't leak copies). That's the right granularity for a serverless
 * Vercel function: warm invocations hit the cache, cold starts rebuild it
 * — no external Redis needed for this scale. When the app actually grows
 * 1000x the same shape lifts to Upstash/Redis by swapping this file.
 */

type Entry<T> = { value: T; expiresAt: number };
type Pending<T> = Promise<T>;

const globalForCache = globalThis as unknown as {
  __mtCache?: Map<string, Entry<unknown>>;
  __mtCachePending?: Map<string, Pending<unknown>>;
};

function store(): Map<string, Entry<unknown>> {
  if (!globalForCache.__mtCache) globalForCache.__mtCache = new Map();
  return globalForCache.__mtCache;
}

function inflight(): Map<string, Pending<unknown>> {
  if (!globalForCache.__mtCachePending) globalForCache.__mtCachePending = new Map();
  return globalForCache.__mtCachePending;
}

export function cacheGet<T>(key: string): T | undefined {
  const hit = store().get(key) as Entry<T> | undefined;
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store().delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store().set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDelete(prefix: string): void {
  const s = store();
  for (const k of s.keys()) if (k.startsWith(prefix)) s.delete(k);
}

/**
 * Read-through cache with request coalescing.
 *
 *   const result = await getOrSet("summary:42", 30_000, () => computeSummary(42));
 *
 * - If the key is fresh, returns the cached value synchronously (still a
 *   Promise for call-site uniformity but resolved on the microtask queue).
 * - If a loader for the same key is already running, awaits that loader
 *   instead of starting a second one.
 * - Otherwise runs `loader()`, caches success, and drops the in-flight slot.
 */
export async function getOrSet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;

  const pending = inflight();
  const running = pending.get(key) as Promise<T> | undefined;
  if (running) return running;

  const p = (async () => {
    try {
      const value = await loader();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, p);
  return p;
}
