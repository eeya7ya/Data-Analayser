import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import CatalogueManager, {
  type CatalogueItem,
  type VendorFacet,
} from "@/components/CatalogueManager";

export const dynamic = "force-dynamic";

export default async function CatalogueAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/designer");

  await ensureSchema();
  const db = sql();
  const items = (await db`
    select id, vendor, category, sub_category, model, description,
           description_locked, currency, price_dpp, price_si,
           price_end_user, specs, active, created_at, updated_at
      from catalogue_items
     order by vendor, category, model
     limit 50
  `) as CatalogueItem[];

  const totalRows = (await db`
    select count(*)::int as n from catalogue_items
  `) as Array<{ n: number }>;

  const facets = (await db`
    select vendor, category, count(*)::int as n
      from catalogue_items
     where active = true
     group by vendor, category
     order by vendor, category
  `) as VendorFacet[];

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-magic-ink">
            Admin · Catalogue
          </h1>
          <p className="text-sm text-magic-ink/70">
            Browse, edit, bulk-upload and regenerate the product catalogue.
            Prices change ~4×/year — use the Upload Excel tab to apply a batch
            update in a single dry-run preview + commit.
          </p>
        </header>
        <CatalogueManager
          initialItems={items}
          initialTotal={totalRows[0]?.n || items.length}
          facets={facets}
        />
      </main>
    </div>
  );
}
