import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAll, getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { hasModuleRole } from "@/lib/modules";
import TopBar from "@/components/TopBar";
import ScheduleBoard from "@/components/ScheduleBoard";

export const dynamic = "force-dynamic";

/**
 * Project-manager day scheduler. Manager/admin only — it's a cross-project
 * coordination surface (every technician's workload in one grid), so it's
 * gated the same way assignment management is.
 */
export default async function ProjectSchedulePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  await ensureSchema();

  const isManager =
    canReadAll(user) || (await hasModuleRole(user.id, "projects", "manager"));

  if (!isManager) {
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="mx-auto max-w-3xl px-6 py-10 text-center">
          <h1 className="mb-2 text-xl font-bold text-magic-ink">Schedule</h1>
          <p className="text-sm text-magic-ink/60">
            The day scheduler is for project managers. You need{" "}
            <code className="rounded bg-magic-soft px-1 text-xs">
              projects.manager
            </code>{" "}
            access. Ask an admin in the Modules tab.
          </p>
          <Link
            href="/projects"
            className="mt-4 inline-block rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
          >
            Back to projects
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-magic-ink">Day schedule</h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Arrange who works which project on which day. Drag to reschedule or
            reassign; double-bookings are flagged.
          </p>
        </header>
        <ScheduleBoard />
      </main>
    </div>
  );
}
