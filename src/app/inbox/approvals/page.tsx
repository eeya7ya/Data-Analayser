import Link from "next/link";
import { redirect } from "next/navigation";
import { sql, ensureSchema } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

/**
 * Approval inbox for sales_manager / presales_manager users.
 *
 * Lists quotations that need this user's signoff: the side this
 * caller approves is not yet stamped AND the quotation isn't already
 * fully approved or rejected. Admins see every pending row across
 * both sides. Each row links to the quotation viewer where the
 * Approve / Reject buttons live (Phase 4).
 *
 * Nothing is mutated by this page — it's a filtered read of
 * quotations.
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
  sales_approved_at: string | null;
  presales_approved_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  totals_json: Record<string, unknown> | null;
}

export default async function ApprovalsInboxPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isAdmin = user.role === "admin";
  const isSalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "sales_manager"));
  const isPresalesManager =
    isAdmin || (await hasModuleRole(user.id, "crm", "presales_manager"));

  if (!isSalesManager && !isPresalesManager) {
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
            </code>{" "}
            or{" "}
            <code className="text-xs bg-magic-soft px-1 rounded">
              crm.presales_manager
            </code>
            . Ask an admin in the Modules tab if you should have one.
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
  // Three queries so each section has its own clear filter — keeping
  // them separate avoids a four-way OR that the planner sometimes
  // misjudges. Limits are generous (200 each) because real-life
  // pending queues should never get that long.
  const needsSales: InboxRow[] = isSalesManager
    ? ((await q`
        select qq.id, qq.ref, qq.project_name, qq.client_name,
               u.username as owner_username,
               qq.status, qq.created_at, qq.updated_at,
               qq.sales_approved_at, qq.presales_approved_at,
               qq.approved_at, qq.rejected_at, qq.totals_json
        from quotations qq
        left join users u on u.id = qq.owner_id
        where qq.deleted_at is null
          and qq.sales_approved_at is null
          and qq.rejected_at is null
          and qq.approved_at is null
        order by qq.created_at desc
        limit 200
      `) as InboxRow[])
    : [];

  const needsPresales: InboxRow[] = isPresalesManager
    ? ((await q`
        select qq.id, qq.ref, qq.project_name, qq.client_name,
               u.username as owner_username,
               qq.status, qq.created_at, qq.updated_at,
               qq.sales_approved_at, qq.presales_approved_at,
               qq.approved_at, qq.rejected_at, qq.totals_json
        from quotations qq
        left join users u on u.id = qq.owner_id
        where qq.deleted_at is null
          and qq.presales_approved_at is null
          and qq.rejected_at is null
          and qq.approved_at is null
        order by qq.created_at desc
        limit 200
      `) as InboxRow[])
    : [];

  // Reference reading — quotations stamped on this caller's side but
  // still waiting on the other side. So managers can verify their own
  // signoff didn't get lost and follow up with the other manager.
  const halfApproved = (await q`
    select qq.id, qq.ref, qq.project_name, qq.client_name,
           u.username as owner_username,
           qq.status, qq.created_at, qq.updated_at,
           qq.sales_approved_at, qq.presales_approved_at,
           qq.approved_at, qq.rejected_at, qq.totals_json
    from quotations qq
    left join users u on u.id = qq.owner_id
    where qq.deleted_at is null
      and qq.approved_at is null
      and qq.rejected_at is null
      and (qq.sales_approved_at is not null or qq.presales_approved_at is not null)
    order by qq.created_at desc
    limit 100
  `) as InboxRow[];

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto px-6 py-6 lg:px-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-magic-ink">
            Approval inbox
          </h1>
          <p className="text-sm text-magic-ink/60 mt-0.5">
            Quotations waiting for your signoff. Click any row to open the
            viewer and use Approve / Reject from the bar at the top.
          </p>
        </div>

        {isSalesManager && (
          <InboxSection
            title="Awaiting your Sales approval"
            empty="No quotations need a Sales signoff."
            rows={needsSales}
            ownSide="sales"
          />
        )}

        {isPresalesManager && (
          <InboxSection
            title="Awaiting your Presales approval"
            empty="No quotations need a Presales signoff."
            rows={needsPresales}
            ownSide="presales"
          />
        )}

        <InboxSection
          title="Half-approved (one side pending)"
          empty="No quotations are stuck between sides."
          rows={halfApproved}
          ownSide="reference"
        />
      </main>
    </div>
  );
}

function InboxSection({
  title,
  empty,
  rows,
  ownSide,
}: {
  title: string;
  empty: string;
  rows: InboxRow[];
  ownSide: "sales" | "presales" | "reference";
}) {
  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-magic-ink">
          {title}
          <span className="ml-2 inline-flex items-center rounded-full bg-magic-soft px-2 py-0.5 text-xs font-medium text-magic-ink/70">
            {rows.length}
          </span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">{empty}</p>
      ) : (
        <ul className="divide-y divide-magic-border/60">
          {rows.map((r) => (
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
              <div className="flex items-center gap-1.5 text-xs">
                <SidePill stamped={!!r.sales_approved_at} label="Sales" />
                <SidePill
                  stamped={!!r.presales_approved_at}
                  label="Presales"
                />
                {ownSide !== "reference" && (
                  <Link
                    href={`/quotation?id=${r.id}`}
                    className="ml-2 rounded border border-magic-red text-magic-red px-2.5 py-1 font-semibold hover:bg-magic-red hover:text-white transition-colors"
                  >
                    Review
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SidePill({ stamped, label }: { stamped: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${
        stamped
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-magic-border bg-magic-soft/40 text-magic-ink/60"
      }`}
    >
      {label} {stamped ? "✓" : "pending"}
    </span>
  );
}
