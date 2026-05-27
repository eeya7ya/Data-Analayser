import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema, sql } from "@/lib/db";
import { canCreateLead } from "@/lib/leads";
import TopBar from "@/components/TopBar";
import LeadCreateForm, { type LeadContext } from "@/components/LeadCreateForm";

export const dynamic = "force-dynamic";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; company?: string; contact?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  if (!(await canCreateLead(user))) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-2xl px-6 py-10 text-center">
          <h1 className="mb-2 text-xl font-bold text-magic-ink">Open a lead</h1>
          <p className="text-sm text-magic-ink/60">
            You need a CRM role (sales, sales_manager, presales, or
            presales_manager) to open a lead. Ask an admin in Admin → Modules.
          </p>
        </main>
      </div>
    );
  }

  // Resolve smart-assign context for a Request for Quotation opened from a
  // client / project. We look the rows up here (server-side, scoped to what
  // the user can read) so the form can show real names; the create API
  // re-validates the IDs before persisting them.
  const sp = await searchParams;
  const ownerScope = canReadAll(user) ? null : user.id;
  let context: LeadContext | undefined;
  const folderId = Number(sp.folder);
  const companyId = Number(sp.company);
  const contactId = Number(sp.contact);
  if (Number.isInteger(folderId) && folderId > 0) {
    const q = sql();
    const rows = (await q`
      select cf.id, cf.name, cf.company_id, co.name as company_name
      from client_folders cf
      left join companies co on co.id = cf.company_id
      where cf.id = ${folderId} and cf.deleted_at is null
        and (${ownerScope}::int is null or cf.owner_id = ${ownerScope})
      limit 1
    `) as Array<{
      id: number;
      name: string;
      company_id: number | null;
      company_name: string | null;
    }>;
    if (rows.length > 0) {
      const f = rows[0];
      context = {
        folderId: f.id,
        companyId: f.company_id,
        contactId:
          Number.isInteger(contactId) && contactId > 0 ? contactId : null,
        clientName: f.name,
        companyName: f.company_name,
        prefillTitle: `RFQ — ${f.name}`,
      };
    }
  } else if (Number.isInteger(companyId) && companyId > 0) {
    const q = sql();
    const rows = (await q`
      select id, name from companies
      where id = ${companyId} and deleted_at is null
        and (${ownerScope}::int is null or owner_id = ${ownerScope})
      limit 1
    `) as Array<{ id: number; name: string }>;
    if (rows.length > 0) {
      context = {
        companyId: rows[0].id,
        companyName: rows[0].name,
        prefillTitle: `RFQ — ${rows[0].name}`,
      };
    }
  }

  const isRfq = Boolean(context);

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <Link
            href="/leads"
            className="text-xs font-semibold uppercase tracking-wide text-magic-ink/50 hover:text-magic-red"
          >
            ← Back to leads
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-magic-ink">
            {isRfq ? "Request for Quotation" : "Open a new lead"}
          </h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            Once submitted, the presales manager is emailed to triage and assign
            the lead to a specific presales engineer.
          </p>
        </header>
        <LeadCreateForm context={context} />
      </main>
    </div>
  );
}
