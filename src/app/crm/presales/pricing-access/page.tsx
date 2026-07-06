import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { isPresalesManager } from "@/lib/modules";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import PresalesPricingAccessClient, {
  type PresalesMember,
} from "@/components/PresalesPricingAccessClient";

export const dynamic = "force-dynamic";

/**
 * /crm/presales/pricing-access — the presales manager grants or revokes
 * Pricing-module access for individual presales members. Admins can use it
 * too; everyone else is bounced back to the CRM hub.
 */
export default async function PresalesPricingAccessPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();
  if (!(await isPresalesManager(user))) redirect("/crm?tool=presales");

  const q = sql();
  const members = (await q`
    select u.id, u.username, u.display_name,
      exists (
        select 1 from user_module_roles m
        where m.user_id = u.id and m.module = 'crm'
          and m.role = 'presales_manager' and m.revoked_at is null
      ) as is_manager,
      exists (
        select 1 from user_module_roles p
        where p.user_id = u.id and p.module = 'pricing' and p.revoked_at is null
      ) as has_pricing
    from users u
    where exists (
      select 1 from user_module_roles c
      where c.user_id = u.id and c.module = 'crm'
        and c.role in ('presales', 'presales_manager')
        and c.revoked_at is null
    )
    order by coalesce(nullif(u.display_name, ''), u.username)
  `) as PresalesMember[];

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
            <Link href="/crm?tool=presales" className="hover:text-magic-red">
              CRM
            </Link>{" "}
            <span>→</span> Presales
          </div>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">
            Pricing access
          </h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Choose which presales members can open the Pricing module. You (and
            other presales managers) always have access.
          </p>
        </div>

        <PresalesPricingAccessClient initial={members} />
      </main>
    </div>
  );
}
