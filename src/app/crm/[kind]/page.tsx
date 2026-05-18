import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/**
 * /crm/company             list of company-kind clients
 * /crm/individual          list of individual-kind clients
 * /crm/unclassified        list of folders with kind = NULL
 *                          (the migration quarantine, surfaced here
 *                          too so non-admins can see and request
 *                          re-classification without going to admin)
 *
 * Every row links to /crm/[kind]/[id] where the existing folder
 * drill-down (projects + quotations + POs + files) renders. The
 * folder rows are never deleted; "unclassified" is the read-time
 * filter, not a state.
 */

type Kind = "company" | "individual" | "unclassified";

interface FolderListRow {
  id: number;
  name: string;
  kind: "company" | "individual" | null;
  client_company: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_name: string | null;
  owner_username: string | null;
  project_count: number;
  quotation_count: number;
  latest_quotation_at: string | null;
}

const TITLES: Record<Kind, { title: string; sub: string }> = {
  company: {
    title: "Company clients",
    sub: "Business clients linked to a row in the companies directory.",
  },
  individual: {
    title: "Individual clients",
    sub: "Personal / residential clients.",
  },
  unclassified: {
    title: "Unclassified clients",
    sub: "Folders that haven't been marked Company or Individual yet. They're not lost — admin can classify them from Admin → Folders.",
  },
};

export default async function CrmKindPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind: kindParam } = await params;
  if (
    kindParam !== "company" &&
    kindParam !== "individual" &&
    kindParam !== "unclassified"
  ) {
    notFound();
  }
  // Static routes /crm/company and /crm/individual normally win over
  // this dynamic [kind] match, but if someone calls into this file
  // directly (e.g. via a stale framework cache) we still redirect so
  // the user never lands on the old "list folders by kind" UI.
  if (kindParam === "company") redirect("/crm/company");
  if (kindParam === "individual") redirect("/crm/individual");
  const kind = kindParam as Kind;

  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const q = sql();

  // Owner-isolation for non-admins, matching the existing
  // /api/folders behaviour. Admin sees every folder of this kind.
  const kindFilter = kind === "unclassified" ? null : kind;

  const rows = isAdmin
    ? ((await q`
        select cf.id, cf.name, cf.kind, cf.client_company,
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
        where cf.deleted_at is null
          and cf.kind is not distinct from ${kindFilter}
        order by latest_quotation_at desc nulls last, cf.name
        limit 500
      `) as FolderListRow[])
    : ((await q`
        select cf.id, cf.name, cf.kind, cf.client_company,
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
        where cf.deleted_at is null
          and cf.owner_id = ${user.id}
          and cf.kind is not distinct from ${kindFilter}
        order by latest_quotation_at desc nulls last, cf.name
        limit 200
      `) as FolderListRow[]);

  const meta = TITLES[kind];

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
            {meta.title}
          </h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">{meta.sub}</p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-magic-border bg-white p-8 text-center">
            <p className="text-magic-ink/70 mb-2">No clients here yet.</p>
            <p className="text-sm text-magic-ink/50">
              {kind === "unclassified"
                ? "Nothing to classify — every folder you can see already has a kind."
                : isAdmin
                  ? `Add a new ${kind} folder from the legacy list or run a classify pass in Admin → Folders.`
                  : "You don't own any folders in this list yet."}
            </p>
            <Link
              href="/quotation"
              className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft transition-colors"
            >
              Open legacy list →
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((f) => (
              <li
                key={f.id}
                className="rounded-xl border border-magic-border bg-white p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/crm/${kind}/${f.id}`}
                      className="font-semibold text-magic-ink hover:text-magic-red"
                    >
                      {f.name}
                    </Link>
                    {f.kind === null && (
                      <span className="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                        Unclassified
                      </span>
                    )}
                    <div className="text-xs text-magic-ink/60 mt-0.5">
                      {f.company_name && <>linked: {f.company_name} · </>}
                      {f.client_company && !f.company_name && (
                        <>{f.client_company} · </>
                      )}
                      {f.client_email && <>{f.client_email} · </>}
                      {f.owner_username && <>owner @{f.owner_username}</>}
                    </div>
                    <div className="text-xs text-magic-ink/50 mt-1">
                      {f.project_count} project
                      {f.project_count === 1 ? "" : "s"} ·{" "}
                      {f.quotation_count} quotation
                      {f.quotation_count === 1 ? "" : "s"}
                      {f.latest_quotation_at && (
                        <>
                          {" "}
                          · latest{" "}
                          {new Date(
                            f.latest_quotation_at,
                          ).toLocaleDateString()}
                        </>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/crm/${kind}/${f.id}`}
                    className="shrink-0 rounded-lg border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft transition-colors"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
