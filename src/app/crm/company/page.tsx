import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import CompanyListClient from "@/components/CompanyListClient";

export const dynamic = "force-dynamic";

/**
 * /crm/company — list of company entities (rows in the `companies`
 * table), not folders. Drill into one to see its clients (the folders
 * linked via `client_folders.company_id`). Adds a search box and a
 * "+ New company" affordance.
 *
 * Folders with kind='company' but NO company_id (the migration
 * leftovers) surface in a separate "Unassigned company folders"
 * callout so admins can attach them to a company — no row is ever
 * stranded.
 */

interface CompanyListRow {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
  client_count: number;
  quotation_count: number;
  deleted_at: string | null;
}

export default async function CompanyListPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = user.role === "admin";
  const q = sql();
  // Counts must also follow `contacts.company_id → contacts.folder_id`,
  // not just `client_folders.company_id`. Post-refactor a person can be
  // linked to a company through the contacts table while their folder
  // still has company_id = NULL until syncCompanyPeopleAndFolders heals
  // it on first detail-page visit. Counting via both keeps the list
  // honest before that lazy heal runs.
  const rows = isAdmin
    ? ((await q`
        select c.id, c.name, c.website, c.industry, c.size_bucket, c.notes,
               (select count(*) from (
                  select cf.id from client_folders cf
                    where cf.company_id = c.id and cf.deleted_at is null
                  union
                  select ct.folder_id as id from contacts ct
                    where ct.company_id = c.id and ct.deleted_at is null
                      and ct.folder_id is not null
                      and exists (select 1 from client_folders cf2
                                  where cf2.id = ct.folder_id
                                    and cf2.deleted_at is null)
               ) as client_ids) as client_count,
               (select count(*) from quotations qq
                  where qq.deleted_at is null and qq.folder_id in (
                    select cf.id from client_folders cf
                      where cf.company_id = c.id and cf.deleted_at is null
                    union
                    select ct.folder_id from contacts ct
                      where ct.company_id = c.id and ct.deleted_at is null
                        and ct.folder_id is not null
                  )) as quotation_count,
               c.deleted_at
        from companies c
        where c.deleted_at is null
        order by c.name
      `) as CompanyListRow[])
    : ((await q`
        select c.id, c.name, c.website, c.industry, c.size_bucket, c.notes,
               (select count(*) from (
                  select cf.id from client_folders cf
                    where cf.company_id = c.id and cf.deleted_at is null
                  union
                  select ct.folder_id as id from contacts ct
                    where ct.company_id = c.id and ct.deleted_at is null
                      and ct.folder_id is not null
                      and exists (select 1 from client_folders cf2
                                  where cf2.id = ct.folder_id
                                    and cf2.deleted_at is null)
               ) as client_ids) as client_count,
               (select count(*) from quotations qq
                  where qq.deleted_at is null and qq.folder_id in (
                    select cf.id from client_folders cf
                      where cf.company_id = c.id and cf.deleted_at is null
                    union
                    select ct.folder_id from contacts ct
                      where ct.company_id = c.id and ct.deleted_at is null
                        and ct.folder_id is not null
                  )) as quotation_count,
               c.deleted_at
        from companies c
        where c.deleted_at is null and c.owner_id = ${user.id}
        order by c.name
      `) as CompanyListRow[]);

  // Folders that say kind=company but have no company_id are leftovers
  // from the V2 migration. They need to be attached to a Company. We
  // count them here so admin can act if anything's stuck.
  const orphans = (await q`
    select count(*) as n from client_folders
    where deleted_at is null and kind = 'company' and company_id is null
  `) as Array<{ n: number }>;
  const unattachedFolderCount = Number(orphans[0]?.n ?? 0);

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-8 lg:px-10 space-y-5">
        <div>
          <div className="text-xs text-magic-ink/50">
            <Link href="/" className="hover:text-magic-red">
              Dashboard
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm" className="hover:text-magic-red">
              CRM
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-magic-ink mt-1">Companies</h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">
            Top-level business entities. Drill in to assign clients (the
            people at the company) and then projects under each client.
          </p>
        </div>

        {unattachedFolderCount > 0 && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <h2 className="text-sm font-semibold text-amber-800">
              {unattachedFolderCount} client folder
              {unattachedFolderCount === 1 ? "" : "s"} marked company but not
              attached to one
            </h2>
            <p className="text-xs text-amber-700/80 mt-1">
              These folders aren&apos;t lost — they keep working, they just
              don&apos;t show up under any company yet. Attach them by
              opening the folder and picking a company, or run a bulk pass
              in Admin → Folders.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Link
                href="/crm/unclassified"
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
              >
                Open unattached folders
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                >
                  Admin → Folders quarantine
                </Link>
              )}
            </div>
          </section>
        )}

        <CompanyListClient initial={rows} />
      </main>
    </div>
  );
}
