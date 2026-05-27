import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import UnclassifiedClientsList from "@/components/UnclassifiedClientsList";

export const dynamic = "force-dynamic";

/**
 * /crm/unclassified — folders that haven't been marked Company or
 * Individual yet (kind = NULL, a migration quarantine). They're never
 * lost; admin can classify them from Admin → Folders. Each row opens the
 * universal per-folder drill-down at /folder/[id].
 *
 * This used to be served by the dynamic /crm/[kind] catch-all. That tree
 * was removed once the Company/Individual trees became canonical — its
 * only remaining job was rendering this list, so it lives here now as a
 * plain static route.
 */

interface FolderListRow {
  id: number;
  name: string;
  client_company: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_name: string | null;
  owner_username: string | null;
  project_count: number;
  quotation_count: number;
  latest_quotation_at: string | null;
}

export default async function UnclassifiedClientsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const q = sql();

  const rows = isAdmin
    ? ((await q`
        select cf.id, cf.name, cf.client_company,
               cf.client_email, cf.client_phone,
               c.name as company_name,
               u.username as owner_username,
               (select count(*) from projects p
                  where p.folder_id = cf.id and p.deleted_at is null) as project_count,
               (select count(*) from quotations qq
                  where qq.folder_id = cf.id and qq.deleted_at is null) as quotation_count,
               (select max(qq.created_at) from quotations qq
                  where qq.folder_id = cf.id and qq.deleted_at is null) as latest_quotation_at
        from client_folders cf
        left join companies c on c.id = cf.company_id and c.deleted_at is null
        left join users u on u.id = cf.owner_id
        where cf.deleted_at is null and cf.kind is null
        order by latest_quotation_at desc nulls last, cf.name
        limit 500
      `) as FolderListRow[])
    : ((await q`
        select cf.id, cf.name, cf.client_company,
               cf.client_email, cf.client_phone,
               c.name as company_name,
               u.username as owner_username,
               (select count(*) from projects p
                  where p.folder_id = cf.id and p.deleted_at is null) as project_count,
               (select count(*) from quotations qq
                  where qq.folder_id = cf.id and qq.deleted_at is null) as quotation_count,
               (select max(qq.created_at) from quotations qq
                  where qq.folder_id = cf.id and qq.deleted_at is null) as latest_quotation_at
        from client_folders cf
        left join companies c on c.id = cf.company_id and c.deleted_at is null
        left join users u on u.id = cf.owner_id
        where cf.deleted_at is null and cf.kind is null
          and cf.owner_id = ${user.id}
        order by latest_quotation_at desc nulls last, cf.name
        limit 200
      `) as FolderListRow[]);

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
            Unclassified clients
          </h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">
            Folders that haven&apos;t been marked Company or Individual yet.
            They&apos;re not lost — admin can classify them from Admin → Folders.
          </p>
        </div>

        <UnclassifiedClientsList initial={rows} />
      </main>
    </div>
  );
}
