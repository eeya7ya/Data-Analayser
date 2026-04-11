import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import TopBar from "@/components/TopBar";
import QuotationViewer from "@/components/QuotationViewer";
import FolderExportImport from "@/components/FolderExportImport";
import QuotationsPageTabs from "@/components/QuotationsPageTabs";

/**
 * Server-side preload for the /quotation list view so the Clients & Quotations
 * page renders with its data already in place. The client component used to
 * mount with empty skeletons and fire off two parallel fetches, which felt
 * laggy on cold starts — especially because this is the "home" screen most
 * users open first. Loading here means Next.js streams the HTML with the
 * groups already populated.
 */
/**
 * Server-side preload budget. We'd rather ship an empty skeleton and let the
 * client fetch the data async than keep the user staring at a blank browser
 * tab while Supabase cold-starts. When this race trips, `loadListData`
 * returns `null` and the page hands `undefined` to the client component,
 * which triggers its own /api/quotations + /api/folders round-trip with a
 * visible loading state.
 */
const PRELOAD_BUDGET_MS = 2500;

async function loadListData(user: SessionUser): Promise<{
  quotations: Array<Record<string, unknown>>;
  folders: Array<Record<string, unknown>>;
} | null> {
  const work = (async () => {
    await ensureSchema();
    const q = sql();
    const [quotations, folders] = await Promise.all([
      user.role === "admin"
        ? (q`
            select q.id, q.ref, q.project_name, q.client_name, q.site_name,
                   q.folder_id, q.owner_id, q.created_at, q.updated_at,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from quotations q
            left join users u on u.id = q.owner_id
            where q.deleted_at is null
            order by q.id desc
            limit 500
          ` as unknown as Promise<Array<Record<string, unknown>>>)
        : (q`
            select id, ref, project_name, client_name, site_name,
                   folder_id, owner_id, created_at, updated_at
            from quotations
            where owner_id = ${user.id}
              and deleted_at is null
            order by id desc
            limit 200
          ` as unknown as Promise<Array<Record<string, unknown>>>),
      user.role === "admin"
        ? (q`
            select f.id, f.name, f.owner_id, f.created_at, f.updated_at,
                   f.client_email, f.client_phone, f.client_company,
                   u.username as owner_username,
                   u.display_name as owner_display_name
            from client_folders f
            left join users u on u.id = f.owner_id
            where f.deleted_at is null
            order by u.username nulls first, f.name asc
          ` as unknown as Promise<Array<Record<string, unknown>>>)
        : (q`
            select id, name, owner_id, created_at, updated_at,
                   client_email, client_phone, client_company
            from client_folders
            where owner_id = ${user.id}
              and deleted_at is null
            order by name asc
          ` as unknown as Promise<Array<Record<string, unknown>>>),
    ]);
    return { quotations, folders };
  })();

  // `PRELOAD_TIMEOUT` is our own sentinel so we can distinguish a slow DB
  // (hand off to the client) from a real query error (show empty state).
  const timeout = new Promise<"PRELOAD_TIMEOUT">((resolve) =>
    setTimeout(() => resolve("PRELOAD_TIMEOUT"), PRELOAD_BUDGET_MS),
  );

  try {
    const result = await Promise.race([work, timeout]);
    if (result === "PRELOAD_TIMEOUT") return null;
    return result;
  } catch {
    // Query error (schema, auth, bad connection) — render an empty list so
    // the page still paints. The client component will just show "No
    // quotations yet." instead of hanging forever.
    return { quotations: [], folders: [] };
  }
}

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
}

export default async function QuotationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;

  // Single-quotation view still needs the server-side lookup because it
  // drives the full printable document. The list view (no id) now also
  // fetches data on the server so the first paint shows the real groups
  // instead of skeleton placeholders.
  if (sp.id) {
    await ensureSchema();
    const appSettings = await getAppSettings();
    const q = sql();
    const rows = (await q`
      select * from quotations
      where id = ${Number(sp.id)} and deleted_at is null
      limit 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (
      row &&
      user.role !== "admin" &&
      Number(row.owner_id) !== user.id
    ) {
      return (
        <div className="min-h-screen bg-magic-soft/40">
          <TopBar user={user} />
          <main className="max-w-5xl mx-auto p-6">
            <p className="text-sm text-magic-ink/70">
              You don&apos;t have access to this quotation.
            </p>
          </main>
        </div>
      );
    }
    if (!row) {
      return (
        <div className="min-h-screen bg-magic-soft/40">
          <TopBar user={user} />
          <main className="max-w-5xl mx-auto p-6">
            <p className="text-sm text-magic-ink/70">Quotation not found.</p>
          </main>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <div className="no-print">
          <TopBar user={user} />
        </div>
        <main className="max-w-5xl mx-auto p-6">
          <QuotationViewer row={row} appSettings={appSettings} />
        </main>
      </div>
    );
  }

  // `loaded === null` means the server-side preload exceeded its budget and
  // we handed the fetch back to the client so the page can still stream its
  // shell immediately. `initialQuotations` / `initialFolders` stay
  // `undefined` in that case and QuotationListClient's own loader kicks in.
  const loaded = await loadListData(user);

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-magic-ink">
            Clients &amp; Quotations
          </h1>
          <FolderExportImport />
        </div>
        <QuotationsPageTabs
          isAdmin={user.role === "admin"}
          initialQuotations={loaded?.quotations}
          initialFolders={loaded?.folders}
        />
      </main>
    </div>
  );
}
