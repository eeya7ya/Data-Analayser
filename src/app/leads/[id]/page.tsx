import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import LeadDetailClient from "@/components/LeadDetailClient";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-2xl px-6 py-10 text-center text-sm text-magic-ink/60">
          Invalid lead id.
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/30">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        <header className="mb-5">
          <Link
            href="/leads"
            className="text-xs font-semibold uppercase tracking-wide text-magic-ink/50 hover:text-magic-red"
          >
            ← Back to leads
          </Link>
        </header>
        <LeadDetailClient leadId={leadId} />
      </main>
    </div>
  );
}
