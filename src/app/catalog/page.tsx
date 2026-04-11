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
 * Loads the list of vendor/system pairs on the server so the catalogue page
 * renders with the vendor dropdown already populated — the client used to
 * mount, show an empty "Pick a system" select, then fire off /api/catalogue
 * /systems and re-render. On cold starts (serverless DB wake-up) that round
 * trip felt like a lag; server-side fetch eliminates it.
 */
async function loadSystems(): Promise<SystemInfo[]> {
  try {
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
  } catch {
    return [];
  }
}

export default async function CatalogPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const initialSystems = await loadSystems();
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-7xl mx-auto p-6">
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
