import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import CalendarMarkerClient from "@/components/CalendarMarkerClient";

export const dynamic = "force-dynamic";

/**
 * /calendar — the personal Calendar Marker tool. Available to every
 * signed-in user; all data is private (scoped to the user server-side).
 * One page shows one week and fills the viewport.
 */
export default async function CalendarPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  return (
    <div className="flex min-h-screen flex-col bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8">
        <CalendarMarkerClient />
      </main>
    </div>
  );
}
