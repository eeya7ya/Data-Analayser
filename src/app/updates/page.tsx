import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import UpdateNotesPanel from "@/components/UpdateNotesPanel";

export const dynamic = "force-dynamic";

/**
 * /updates — the dedicated "Update notes" feed. Available to every
 * signed-in user; the panel itself reuses /api/news, which the server
 * filters to the user's modules + roles, so each person only sees the
 * notes that target them.
 */
export default async function UpdatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  return (
    <div className="flex min-h-screen flex-col bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
            Updates
          </h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            What changed in your modules — newest first.
          </p>
        </div>
        <UpdateNotesPanel />
      </main>
    </div>
  );
}
