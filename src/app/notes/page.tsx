import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import NotesClient from "@/components/NotesClient";

export const dynamic = "force-dynamic";

/**
 * /notes — the personal "My Notes" notebook. Available to every signed-in
 * user; all notes are private (scoped to the user server-side). Notes can
 * be exported to a branded PDF (MagicTech logo + "My Notes") client-side.
 */
export default async function NotesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  return (
    <div className="flex min-h-screen flex-col bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8">
        <NotesClient
          authorName={user.display_name || user.username}
        />
      </main>
    </div>
  );
}
