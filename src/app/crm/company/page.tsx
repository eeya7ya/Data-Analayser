import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import CompanyListClient from "@/components/CompanyListClient";
import UserScopePicker from "@/components/UserScopePicker";

export const dynamic = "force-dynamic";

interface SearchParams {
  user?: string;
}

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
  file_count: number;
  deleted_at: string | null;
}

export default async function CompanyListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const sp = await searchParams;
  const requested = isAdmin && sp.user ? Number(sp.user) : null;
  const scopeOwnerId = isAdmin
    ? Number.isFinite(requested) && requested! > 0
      ? requested
      : null
    : user.id;
  const q = sql();
  // Counts must also follow `contacts.company_id → contacts.folder_id`,
  // not just `client_folders.company_id`. Post-refactor a person can be
  // linked to a company through the contacts table while their folder
  // still has company_id = NULL until syncCompanyPeopleAndFolders heals
  // it on first detail-page visit. Counting via both keeps the list
  // honest before that lazy heal runs.
  const rows = (await q`
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
           (select count(*) from project_files pf
              join projects p on p.id = pf.project_id and p.deleted_at is null
              where pf.deleted_at is null and p.folder_id in (
                select cf.id from client_folders cf
                  where cf.company_id = c.id and cf.deleted_at is null
                union
                select ct.folder_id from contacts ct
                  where ct.company_id = c.id and ct.deleted_at is null
                    and ct.folder_id is not null
              )) as file_count,
           c.deleted_at
    from companies c
    where c.deleted_at is null
      and (${scopeOwnerId}::int is null or c.owner_id = ${scopeOwnerId})
    order by c.name
  `) as CompanyListRow[];

  // The unattached-company-folder count moved to the TopBar
  // notification bell; the inline amber banner that used to live here
  // was crowding the list above the actual companies.

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

        {isAdmin && <UserScopePicker />}

        <CompanyListClient initial={rows} />
      </main>
    </div>
  );
}
