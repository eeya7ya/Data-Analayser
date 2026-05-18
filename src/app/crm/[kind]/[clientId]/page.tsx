import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import FolderProjectsClient from "@/components/FolderProjectsClient";

export const dynamic = "force-dynamic";

/**
 * /crm/[kind]/[clientId] — client overview inside the CRM drill-down.
 *
 * Reuses FolderProjectsClient (the existing project sidebar + tabs
 * for Quotations / POs / Files). The [kind] segment is validated
 * against the folder's actual kind so a mismatched URL redirects to
 * the correct kind path — that way bookmarks remain stable even when
 * an admin re-classifies a folder.
 *
 * The legacy /folder/[id] page still works and is kept untouched;
 * the Legacy menu in the TopBar links to it for any pre-V2 bookmark.
 */
export default async function CrmClientPage({
  params,
}: {
  params: Promise<{ kind: string; clientId: string }>;
}) {
  const { kind: kindParam, clientId: idParam } = await params;
  if (
    kindParam !== "company" &&
    kindParam !== "individual" &&
    kindParam !== "unclassified"
  ) {
    notFound();
  }
  const folderId = Number(idParam);
  if (!Number.isFinite(folderId) || folderId <= 0) notFound();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const q = sql();
  const folderRows = (await q`
    select cf.id, cf.name, cf.owner_id, cf.kind, cf.company_id,
           cf.client_email, cf.client_phone, cf.client_company,
           c.name as company_name
    from client_folders cf
    left join companies c on c.id = cf.company_id and c.deleted_at is null
    where cf.id = ${folderId} and cf.deleted_at is null
    limit 1
  `) as Array<{
    id: number;
    name: string;
    owner_id: number | null;
    kind: "company" | "individual" | null;
    company_id: number | null;
    company_name: string | null;
    client_email: string | null;
    client_phone: string | null;
    client_company: string | null;
  }>;
  const folder = folderRows[0];
  if (!folder) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-5xl mx-auto p-6">
          <p className="text-sm text-magic-ink/70">
            Client folder not found.
          </p>
          <Link
            href="/crm"
            className="text-magic-red underline text-sm mt-2 inline-block"
          >
            ← Back to CRM
          </Link>
        </main>
      </div>
    );
  }

  // Bounce mismatched URLs to the actual kind path so bookmarks stay
  // stable even when an admin re-classifies. Unclassified folders are
  // accessible from /crm/unclassified — anything else passing through
  // /crm/unclassified for a now-classified folder also redirects.
  const actualKindUrl = folder.kind ?? "unclassified";
  if (actualKindUrl !== kindParam) {
    redirect(`/crm/${actualKindUrl}/${folderId}`);
  }

  if (!canReadAll(user) && folder.owner_id !== user.id) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-5xl mx-auto p-6">
          <p className="text-sm text-magic-ink/70">
            You don&apos;t have access to this client.
          </p>
          <Link
            href="/crm"
            className="text-magic-red underline text-sm mt-2 inline-block"
          >
            ← Back to CRM
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
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
              <Link href={`/crm/${kindParam}`} className="hover:text-magic-red">
                {kindParam}
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
              {folder.company_name && (
                <span>
                  <span className="text-magic-ink/40">company:</span>{" "}
                  {folder.company_name}
                </span>
              )}
              {folder.client_company && !folder.company_name && (
                <span>{folder.client_company}</span>
              )}
              {folder.client_email && <span>{folder.client_email}</span>}
              {folder.client_phone && <span>{folder.client_phone}</span>}
            </div>
          </div>
        </div>
        <FolderProjectsClient folderId={folder.id} folderName={folder.name} />
      </main>
    </div>
  );
}
