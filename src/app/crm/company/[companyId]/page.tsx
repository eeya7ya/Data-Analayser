import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import ClientListClient, {
  type ClientFolderRow,
} from "@/components/ClientListClient";
import ContactsPanel, { type ContactRow } from "@/components/ContactsPanel";
import { EditCompanyButton } from "@/components/EditCompanyDialog";

export const dynamic = "force-dynamic";

/**
 * /crm/company/[companyId] — one company entity with its list of
 * client folders. The folder rows link onward to the existing
 * /folder/[id] page so the project / quotation drill-down keeps
 * working untouched — we add the company breadcrumb without
 * duplicating the folder-detail UI.
 *
 * "+ New client" creates a folder pre-linked to this company via
 * /api/folders { kind: 'company', company_id }.
 */

interface CompanyRow {
  id: number;
  name: string;
  website: string | null;
  industry: string | null;
  size_bucket: string | null;
  notes: string | null;
  owner_id: number | null;
  deleted_at: string | null;
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId: idParam } = await params;
  const companyId = Number(idParam);
  if (!Number.isFinite(companyId) || companyId <= 0) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const q = sql();
  const cRows = (await q`
    select id, name, website, industry, size_bucket, notes,
           owner_id, deleted_at
    from companies where id = ${companyId}
  `) as CompanyRow[];
  if (cRows.length === 0) {
    // Soft-migration fallback: a pre-refactor bookmark to
    // /crm/company/<folderId> would land here with a folder ID, not a
    // company ID. Redirect to the legacy folder page so the user's
    // data is still reachable — no 404 just because the URL semantics
    // changed mid-flight.
    const folderCheck = (await q`
      select id from client_folders where id = ${companyId} and deleted_at is null
    `) as Array<{ id: number }>;
    if (folderCheck.length > 0) {
      redirect(`/folder/${companyId}`);
    }
    notFound();
  }
  const company = cRows[0];

  const isAdmin = user.role === "admin";
  if (!isAdmin && company.owner_id !== user.id) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto p-6 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            You don&apos;t have access to this company
          </h1>
          <p className="text-sm text-magic-ink/60">
            Ask the owner to share access or an admin to grant module roles.
          </p>
          <Link
            href="/crm/company"
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft transition-colors"
          >
            ← All companies
          </Link>
        </main>
      </div>
    );
  }

  const contactRows = (await q`
    select id, owner_id, folder_id, company_id,
           first_name, last_name, email, phone, title, notes, deleted_at
    from contacts
    where company_id = ${companyId} and deleted_at is null
    order by coalesce(last_name, ''), coalesce(first_name, '')
    limit 200
  `) as ContactRow[];

  const folderRows = (await q`
    select cf.id, cf.name, cf.kind, cf.company_id,
           cf.client_email, cf.client_phone, cf.client_company,
           u.username as owner_username,
           (select count(*) from projects p
              where p.folder_id = cf.id and p.deleted_at is null) as project_count,
           (select count(*) from quotations qq
              where qq.folder_id = cf.id and qq.deleted_at is null) as quotation_count,
           (select max(qq.created_at) from quotations qq
              where qq.folder_id = cf.id and qq.deleted_at is null) as latest_quotation_at
    from client_folders cf
    left join users u on u.id = cf.owner_id
    where cf.company_id = ${companyId}
      and cf.deleted_at is null
    order by latest_quotation_at desc nulls last, cf.name
  `) as ClientFolderRow[];

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
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm/company" className="hover:text-magic-red">
              Companies
            </Link>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-magic-ink">
              {company.name}
              {company.deleted_at && (
                <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 align-middle">
                  Archived
                </span>
              )}
            </h1>
            <EditCompanyButton
              company={{
                id: company.id,
                name: company.name,
                website: company.website,
                industry: company.industry,
                size_bucket: company.size_bucket,
                notes: company.notes,
              }}
            />
          </div>
          <div className="mt-1 text-xs text-magic-ink/60 flex flex-wrap gap-x-4 gap-y-1">
            {company.industry && <span>{company.industry}</span>}
            {company.website && (
              <a
                href={
                  company.website.startsWith("http")
                    ? company.website
                    : `https://${company.website}`
                }
                target="_blank"
                rel="noreferrer"
                className="hover:text-magic-red"
              >
                {company.website}
              </a>
            )}
            {company.size_bucket && <span>{company.size_bucket}</span>}
          </div>
          {company.notes && (
            <p className="mt-3 text-sm text-magic-ink/80 whitespace-pre-line">
              {company.notes}
            </p>
          )}
        </div>

        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            People at this company
            <span className="ml-2 text-xs font-normal text-magic-ink/60">
              ({contactRows.length})
            </span>
          </h2>
          <ContactsPanel
            initial={contactRows}
            companyId={companyId}
            folderId={null}
          />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Clients at this company
            <span className="ml-2 text-xs font-normal text-magic-ink/60">
              ({folderRows.length})
            </span>
          </h2>
          <ClientListClient
            initial={folderRows}
            newClientKind="company"
            companyId={companyId}
            linkBase={`/crm/company/${companyId}/clients`}
            newLabel="+ New client"
            searchPlaceholder="Search client name, email, phone…"
            emptyHint="No clients yet. Use + New client to add the first contact at this company."
          />
        </section>
      </main>
    </div>
  );
}
