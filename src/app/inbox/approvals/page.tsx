import Link from "next/link";
import { redirect } from "next/navigation";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser, canReadAll } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/**
 * Approval inbox for sales_manager users (1.4A — sales-only approval).
 *
 * Presales no longer signs off on quotations, so this is purely the sales
 * manager's queue: quotations that aren't approved or rejected yet. Admins
 * see the same queue. Each row links to the quotation viewer where the
 * Approve / Reject buttons live.
 *
 * Nothing is mutated by this page — it's a filtered read of quotations.
 */

interface InboxRow {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  owner_username: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  totals_json: Record<string, unknown> | null;
}

export default async function ApprovalsInboxPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = canReadAll(user);
  const isSalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));

  if (!isSalesManager) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-3xl mx-auto px-6 py-10 text-center">
          <h1 className="text-xl font-bold text-magic-ink mb-2">
            Approvals inbox
          </h1>
          <p className="text-sm text-magic-ink/60">
            This page is for users holding{" "}
            <code className="text-xs bg-magic-soft px-1 rounded">
              crm.sales_manager
            </code>
            . Approvals are a sales responsibility — ask an admin in the
            Modules tab if you should have it.
          </p>
          <Link
            href="/quotation"
            className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
          >
            Back to quotations
          </Link>
        </main>
      </div>
    );
  }

  const q = sql();
  const pending = (await q`
    select qq.id, qq.ref, qq.project_name, qq.client_name,
           u.username as owner_username,
           qq.status, qq.created_at, qq.updated_at, qq.totals_json
    from quotations qq
    left join users u on u.id = qq.owner_id
    where qq.deleted_at is null
      and qq.approved_at is null
      and qq.rejected_at is null
    order by qq.created_at desc
    limit 200
  `) as InboxRow[];

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto px-6 py-6 lg:px-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-magic-ink">Approval inbox</h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">
            Quotations waiting for your sign-off. Click any row to open the
            viewer and use Approve / Reject from the bar at the top.
          </p>
        </div>

        <section className="rounded-2xl border border-magic-border bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-magic-ink">
              Awaiting your approval
              <span className="ml-2 inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 text-xs font-medium text-magic-ink/70">
                {pending.length}
              </span>
            </h2>
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-magic-ink/50 italic">
              No quotations need your sign-off right now.
            </p>
          ) : (
            <ul className="divide-y divide-magic-border/60">
              {pending.map((r) => (
                <li
                  key={r.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/quotation?id=${r.id}`}
                      className="font-mono text-sm font-semibold text-magic-ink hover:text-magic-red"
                    >
                      {r.ref}
                    </Link>
                    <span className="ml-2 text-sm text-magic-ink/70">
                      {r.project_name}
                    </span>
                    <div className="text-xs text-magic-ink/50 mt-0.5">
                      {r.client_name && <>client: {r.client_name} · </>}
                      {r.owner_username && <>owner @{r.owner_username} · </>}
                      created {new Date(r.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Link
                    href={`/quotation?id=${r.id}`}
                    className="rounded border border-magic-red text-magic-red px-2.5 py-1 text-xs font-semibold hover:bg-magic-red hover:text-white transition-colors"
                  >
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
