import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isExecutiveManager } from "@/lib/modules";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import ExecutiveConfirmationsClient, {
  type ExecItem,
} from "@/components/ExecutiveConfirmationsClient";

export const dynamic = "force-dynamic";

/**
 * /crm/executive/confirmations — the executive manager's sign-off queue.
 * Presales / presales managers submit quotations (with pricing) and pricing
 * sheets here; the executive manager confirms or rejects them. Admins can use
 * it too; everyone else is bounced back to the CRM hub.
 */
export default async function ExecutiveConfirmationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();
  if (!(await isExecutiveManager(user))) redirect("/crm");

  const q = sql();
  const quotations = (await q`
    select qq.id, qq.ref, qq.project_name, qq.client_name,
           qq.exec_status, qq.exec_submitted_at, qq.exec_decided_at,
           qq.exec_reject_reason,
           sub.username as submitted_by, own.username as owner
    from quotations qq
    left join users sub on sub.id = qq.exec_submitted_by
    left join users own on own.id = qq.owner_id
    where qq.deleted_at is null and qq.exec_status <> 'none'
    order by qq.exec_status = 'pending' desc, qq.exec_submitted_at desc
    limit 100
  `) as ExecItem[];

  const pricing = (await q`
    select pp.id, pp.name, m.name as manufacturer,
           pp.exec_status, pp.exec_submitted_at, pp.exec_decided_at,
           pp.exec_reject_reason,
           sub.username as submitted_by, own.username as owner
    from pricing_projects pp
    left join pricing_manufacturers m on m.id = pp.manufacturer_id
    left join users sub on sub.id = pp.exec_submitted_by
    left join users own on own.id = pp.user_id
    where pp.deleted_at is null and pp.exec_status <> 'none'
    order by pp.exec_status = 'pending' desc, pp.exec_submitted_at desc
    limit 100
  `) as ExecItem[];

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto max-w-3xl space-y-5 px-6 py-8 lg:px-10">
        <div>
          <div className="text-xs text-magic-ink/50">
            <Link href="/" className="hover:text-magic-red">
              Dashboard
            </Link>{" "}
            <span>→</span>{" "}
            <Link href="/crm" className="hover:text-magic-red">
              CRM
            </Link>{" "}
            <span>→</span> Executive
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">
            Confirmations
          </h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Quotations and pricing sheets submitted by presales for your
            sign-off.
          </p>
        </div>

        <ExecutiveConfirmationsClient
          initialQuotations={quotations}
          initialPricing={pricing}
        />
      </main>
    </div>
  );
}
