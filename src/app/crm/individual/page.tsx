import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import ClientListClient, {
  type ClientFolderRow,
} from "@/components/ClientListClient";

export const dynamic = "force-dynamic";

/**
 * /crm/individual — list of folders marked kind='individual'. Each
 * folder IS the client (no extra Company level between). Clicking
 * one drops the user into the existing /folder/[id] page with
 * projects + quotations + POs + files.
 *
 * Search and "+ New" live inside the shared ClientListClient.
 */
export default async function IndividualListPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = user.role === "admin";
  const q = sql();

  const folderRows = isAdmin
    ? ((await q`
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
        where cf.deleted_at is null
          and cf.kind = 'individual'
        order by latest_quotation_at desc nulls last, cf.name
      `) as ClientFolderRow[])
    : ((await q`
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
        where cf.deleted_at is null
          and cf.kind = 'individual'
          and cf.owner_id = ${user.id}
        order by latest_quotation_at desc nulls last, cf.name
      `) as ClientFolderRow[]);

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
          <h1 className="text-2xl font-bold text-magic-ink mt-1">
            Individual clients
          </h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">
            Personal / residential clients. Each row is a single client with
            its own projects, quotations, POs, and files.
          </p>
        </div>

        <ClientListClient
          initial={folderRows}
          newClientKind="individual"
          companyId={null}
          linkBase="/crm/individual"
          newLabel="+ New individual"
          searchPlaceholder="Search name, email, phone…"
          emptyHint="No individual clients yet. Use + New individual to add the first one."
        />
      </main>
    </div>
  );
}
