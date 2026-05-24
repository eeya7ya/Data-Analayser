import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import HandoffsClient from "@/components/HandoffsClient";

export const dynamic = "force-dynamic";

/**
 * Project handoffs — the queue of approved quotations that sales
 * converted into projects. Projects managers assign a member from here;
 * the assigned member and the originating salesperson see read-only
 * status. Visibility + the assign action are enforced by the API.
 */
export default async function ProjectHandoffsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5">
          <Link href="/crm" className="text-xs text-magic-ink/50 hover:text-magic-red">
            ← CRM
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-magic-ink">Project handoffs</h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Approved quotations converted by sales. Managers assign a project
            member to begin execution.
          </p>
        </div>
        <HandoffsClient />
      </main>
    </div>
  );
}
