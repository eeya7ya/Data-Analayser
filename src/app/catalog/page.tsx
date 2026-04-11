import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import CatalogBrowser from "@/components/CatalogBrowser";
import TopBar from "@/components/TopBar";
import CatalogUploadSection from "./CatalogUploadSection";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
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
        <CatalogBrowser user={user} />
      </main>
    </div>
  );
}
