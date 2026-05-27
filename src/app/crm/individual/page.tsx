import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import ClientListClient, {
  type ClientFolderRow,
} from "@/components/ClientListClient";
import UserScopePicker from "@/components/UserScopePicker";

export const dynamic = "force-dynamic";

interface SearchParams {
  user?: string;
  tool?: string;
}

const TOOL_LABELS: Record<string, string> = {
  sales: "Sales",
  presales: "Presales",
  projects: "Projects",
};

/**
 * /crm/individual — list of folders marked kind='individual'. Each
 * folder IS the client (no extra Company level between). Clicking
 * one drops the user into the existing /folder/[id] page with
 * projects + quotations + POs + files.
 *
 * Search and "+ New" live inside the shared ClientListClient. Admins
 * / viewers can narrow the list to a single user via `?user=<id>`.
 */
export default async function IndividualListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const isAdmin = canReadAll(user);
  const sp = await searchParams;
  const toolLabel = sp.tool ? TOOL_LABELS[sp.tool] : undefined;
  const toolQuery = toolLabel ? `?tool=${sp.tool}` : "";
  const requested = isAdmin && sp.user ? Number(sp.user) : null;
  const scopeOwnerId = isAdmin
    ? Number.isFinite(requested) && requested! > 0
      ? requested
      : null
    : user.id;
  const q = sql();

  // An individual is a folder with kind='individual' AND no link to a
  // company. Either column tying it to a company (`cf.company_id`, or a
  // contact's `contacts.company_id`) means the row belongs under
  // /crm/company/<id> and must not leak in here.
  const folderRows = (await q`
    select cf.id, cf.name, cf.kind, cf.company_id,
           cf.client_email, cf.client_phone, cf.client_company,
           u.username as owner_username,
           (select count(*) from projects p
              where p.folder_id = cf.id and p.deleted_at is null) as project_count,
           (select count(*) from quotations qq
              where qq.folder_id = cf.id and qq.deleted_at is null) as quotation_count,
           (select count(*) from project_files pf
              join projects p on p.id = pf.project_id and p.deleted_at is null
              where p.folder_id = cf.id and pf.deleted_at is null) as file_count,
           (select max(qq.created_at) from quotations qq
              where qq.folder_id = cf.id and qq.deleted_at is null) as latest_quotation_at
    from client_folders cf
    left join users u on u.id = cf.owner_id
    where cf.deleted_at is null
      and cf.kind = 'individual'
      and cf.company_id is null
      and (${scopeOwnerId}::int is null or cf.owner_id = ${scopeOwnerId})
      and not exists (
        select 1 from contacts ct
        where ct.folder_id = cf.id
          and ct.company_id is not null
          and ct.deleted_at is null
      )
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
            </Link>
            {toolLabel && (
              <>
                {" "}
                <span>→</span>{" "}
                <Link
                  href={`/crm?tool=${sp.tool}`}
                  className="hover:text-magic-red"
                >
                  {toolLabel}
                </Link>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-magic-ink mt-1">
            Individual clients
          </h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">
            Personal / residential clients. Each row is a single client with
            its own projects, quotations, POs, and files.
          </p>
        </div>

        {isAdmin && <UserScopePicker />}

        <ClientListClient
          initial={folderRows}
          newClientKind="individual"
          companyId={null}
          linkBase="/crm/individual"
          newLabel="+ New individual"
          searchPlaceholder="Search name, email, phone…"
          emptyHint="No individual clients yet. Use + New individual to add the first one."
          backTool={toolQuery}
        />
      </main>
    </div>
  );
}
