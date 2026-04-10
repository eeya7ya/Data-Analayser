import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import Designer, { type ExistingQuotation } from "@/components/Designer";
import TopBar from "@/components/TopBar";
import { sql, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
}

export default async function DesignerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  let existing: ExistingQuotation | undefined;
  if (sp.id) {
    await ensureSchema();
    const q = sql();
    const rows = (await q`
      select * from quotations where id = ${Number(sp.id)} limit 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (row && (user.role === "admin" || row.owner_id === user.id)) {
      // jsonb round-trips usually hand us a JS array, but corrupted rows or a
      // legacy `{}` default can make it an object/string. Normalize hard so
      // the client never has to defend against a non-array `items_json`.
      const rawItems: unknown = row.items_json;
      const parsedItems: unknown =
        typeof rawItems === "string"
          ? (() => {
              try {
                return JSON.parse(rawItems);
              } catch {
                return [];
              }
            })()
          : rawItems;
      const itemsArray = Array.isArray(parsedItems)
        ? (parsedItems as ExistingQuotation["items_json"])
        : [];

      const rawConfig: unknown = row.config_json;
      const configObject =
        rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
          ? (rawConfig as ExistingQuotation["config_json"])
          : {};

      existing = {
        id: Number(row.id),
        ref: String(row.ref),
        project_name: String(row.project_name),
        client_name: (row.client_name as string) || null,
        client_email: (row.client_email as string) || null,
        client_phone: (row.client_phone as string) || null,
        sales_engineer: (row.sales_engineer as string) || null,
        prepared_by: (row.prepared_by as string) || null,
        site_name: String(row.site_name),
        tax_percent: Number(row.tax_percent ?? 16),
        folder_id: row.folder_id ? Number(row.folder_id) : null,
        items_json: itemsArray,
        config_json: configObject,
      };
    }
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-magic-ink">
            {existing ? `Editing ${existing.ref}` : "Quotation Designer"}
          </h1>
          <p className="text-sm text-magic-ink/70">
            {existing
              ? "Edit the quotation below. Changes are saved when you click Save updates."
              : "Build and edit your quotation. Choose a pricing category, modify the table, and save when ready."}
          </p>
        </header>
        <Designer user={user} existing={existing} />
      </main>
    </div>
  );
}
