import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import UpdatesFeed from "@/components/UpdatesFeed";

export const dynamic = "force-dynamic";

/**
 * /updates — the dedicated product-changelog feed. Available to every
 * signed-in user; the feed reuses /api/news, which the server filters to the
 * user's modules + roles, so each person only sees the notes that target them
 * (presales never sees a sales-only note, and vice-versa).
 */
export default async function UpdatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  return (
    <div className="flex min-h-screen flex-col bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <UpdatesFeed />
      </main>
    </div>
  );
}
