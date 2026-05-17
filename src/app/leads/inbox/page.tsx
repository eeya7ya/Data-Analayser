import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import LeadInboxClient from "@/components/LeadInboxClient";

export const dynamic = "force-dynamic";

export default async function LeadInboxPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

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
          <h1 className="mt-2 text-2xl font-bold text-magic-ink">Inbox</h1>
          <p className="mt-1 text-sm text-magic-ink/60">
            Every lifecycle handoff lands here as a local message. When SMTP /
            API email is wired up later, the same messages will also be sent
            to your email address.
          </p>
        </header>
        <LeadInboxClient />
      </main>
    </div>
  );
}
