import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import CatalogBrowser from "@/components/CatalogBrowser";
import TopBar from "@/components/TopBar";
import CatalogUploadSection from "./CatalogUploadSection";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

interface SystemInfo {
  vendor: string;
  system: string;
  currency: string;
  product_count: number;
}

/**
 * In-process cache for the vendor/system aggregate. The underlying query
 * is a full GROUP BY over `products`, which is by far the slowest thing
 * the catalogue page touches — on a cold Supavisor pooler it routinely
 * pushes the total render past 3 seconds, which is what the user was
 * seeing as "stuck on skeleton forever". The data is effectively static
 * between catalogue uploads, so caching it for a minute is safe.
 *
 * The cache lives on globalThis so Next's dev HMR and warm Vercel
 * lambdas both reuse it.
 */
const SYSTEMS_CACHE_TTL_MS = 60_000;
const SYSTEMS_PRELOAD_BUDGET_MS = 1500;

const globalForCatalog = globalThis as unknown as {
  __mtSystemsCache?: { at: number; data: SystemInfo[] };
};

async function fetchSystemsFromDb(): Promise<SystemInfo[]> {
  await ensureSchema();
  const q = sql();
  const rows = (await q`
    select
      vendor,
      system,
      currency,
      count(*)::int as product_count
    from products
    group by vendor, system, currency
    order by vendor, system
  `) as SystemInfo[];
  return rows;
}

/**
 * Returns the systems list with three layers of protection against slow DB:
 *   1. Serve in-memory cache if fresh (instant, zero round-trips).
 *   2. Race the DB query against a short timeout budget. If the DB wins,
 *      update the cache and return.
 *   3. If the timeout wins, return stale cache (if any) or empty list, and
 *      let the real query finish in the background so the next request is
 *      fast. The client component (`CatalogBrowser`) already falls back to
 *      `/api/catalogue/systems` when it mounts with an empty list, so no
 *      data is lost — the user just sees the browser shell immediately
 *      and the dropdown populates a tick later.
 */
async function loadSystems(): Promise<SystemInfo[]> {
  const cached = globalForCatalog.__mtSystemsCache;
  if (cached && Date.now() - cached.at < SYSTEMS_CACHE_TTL_MS) {
    return cached.data;
  }

  const work = fetchSystemsFromDb().then((data) => {
    globalForCatalog.__mtSystemsCache = { at: Date.now(), data };
    return data;
  });

  const timeout = new Promise<"TIMEOUT">((resolve) =>
    setTimeout(() => resolve("TIMEOUT"), SYSTEMS_PRELOAD_BUDGET_MS),
  );

  try {
    const result = await Promise.race([work, timeout]);
    if (result === "TIMEOUT") {
      // Don't await the background query — it updates the cache on its own
      // via the .then above. Swallow errors so an unhandled rejection
      // doesn't crash the dev overlay.
      work.catch(() => {});
      return cached?.data ?? [];
    }
    return result;
  } catch {
    return cached?.data ?? [];
  }
}

export default async function CatalogPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const initialSystems = await loadSystems();
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-magic-ink">
            Product Catalogue
          </h1>
          <p className="text-sm text-magic-ink/70">
            Pick a system, browse every product with full specs, sort by any
            column, and build a quotation manually.
          </p>
        </header>
        {user.role === "admin" && <CatalogUploadSection />}
        <CatalogBrowser user={user} initialSystems={initialSystems} />
      </main>
    </div>
  );
}
