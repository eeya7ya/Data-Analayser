import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import SyncFolderClient from "@/components/SyncFolderClient";

export const dynamic = "force-dynamic";

/**
 * /sync — the personal "Sync folder" surface. Available to every signed-in
 * user. Mirrors their own files (uploads + files in the clients/projects they
 * own) to/from a folder they pick on their PC, while the app tab is open in a
 * Chromium browser. All the actual filesystem work happens client-side in
 * SyncFolderClient (File System Access API); the server only serves the file
 * manifest and the existing per-file presign/upload endpoints.
 */
export default async function SyncPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await ensureSchema();

  return (
    <div className="flex min-h-screen flex-col bg-magic-soft/40">
      <TopBar user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
            Sync folder
          </h1>
          <p className="mt-0.5 text-sm text-magic-ink/60">
            Keep a folder on your PC mirrored with your files in the app — pull
            down new files and push up ones you add, automatically while
            you&rsquo;re working.
          </p>
        </div>
        <SyncFolderClient />
      </main>
    </div>
  );
}
