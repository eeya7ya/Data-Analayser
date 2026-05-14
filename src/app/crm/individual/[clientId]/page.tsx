import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import ClientProjectsList, {
  type ClientProjectRow,
} from "@/components/ClientProjectsList";

export const dynamic = "force-dynamic";

/**
 * /crm/individual/[clientId] — single individual client. The folder
 * row IS the client (no Company layer above). Lists this client's
 * projects with inline search + "+ New project". Each row links to
 * /crm/individual/[clientId]/[projectId].
 *
 * If the folder gets reclassified company / unclassified later,
 * redirect to the canonical URL so bookmarks self-heal.
 */
export default async function IndividualClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId: clientIdParam } = await params;
  const folderId = Number(clientIdParam);
  if (!Number.isFinite(folderId)) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const q = sql();
  const rows = (await q`
    select id, name, owner_id, kind, company_id,
           client_email, client_phone, client_company
    from client_folders
    where id = ${folderId} and deleted_at is null
    limit 1
  `) as Array<{
    id: number;
    name: string;
    owner_id: number | null;
    kind: "company" | "individual" | null;
    company_id: number | null;
    client_email: string | null;
    client_phone: string | null;
    client_company: string | null;
  }>;
  if (rows.length === 0) notFound();
  const folder = rows[0];

  if (folder.kind === "company" && folder.company_id) {
    redirect(`/crm/company/${folder.company_id}/clients/${folderId}`);
  }
  if (folder.kind === "company" && !folder.company_id) {
    // Marked company but unlinked — surface in the legacy folder view.
    redirect(`/folder/${folderId}`);
  }
  // kind === 'individual' OR kind === null — render here.

  if (user.role !== "admin" && folder.owner_id !== user.id) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto p-6 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            You don&apos;t have access to this client
          </h1>
          <Link
            href="/crm/individual"
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft transition-colors"
          >
            ← All individuals
          </Link>
        </main>
      </div>
    );
  }

  const projects = (await q`
    select id, folder_id, name, description, status, created_at, updated_at
    from projects
    where folder_id = ${folderId} and deleted_at is null
    order by updated_at desc, name
    limit 200
  `) as ClientProjectRow[];

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto px-6 py-6 lg:px-10 space-y-5">
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
            <Link href="/crm/individual" className="hover:text-magic-red">
              Individual clients
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">
            {folder.name}
            {folder.kind === null && (
              <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 align-middle">
                Unclassified
              </span>
            )}
          </h1>
          <div className="mt-1 text-xs text-magic-ink/60 flex flex-wrap gap-x-4 gap-y-1">
            {folder.client_email && <span>{folder.client_email}</span>}
            {folder.client_phone && <span>{folder.client_phone}</span>}
            <Link
              href={`/folder/${folderId}`}
              className="hover:text-magic-red"
            >
              Open legacy folder view →
            </Link>
          </div>
        </div>

        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Projects under this client
            <span className="ml-2 text-xs font-normal text-magic-ink/60">
              ({projects.length})
            </span>
          </h2>
          <ClientProjectsList
            folderId={folderId}
            initial={projects}
            linkBase={`/crm/individual/${folderId}`}
          />
        </section>
      </main>
    </div>
  );
}
