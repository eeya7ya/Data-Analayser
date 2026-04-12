import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import Designer from "@/components/Designer";
import DesignerShell from "@/components/DesignerShell";
import TopBar from "@/components/TopBar";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
  /**
   * Pre-select a client folder when creating a brand-new quotation.
   * Sent by the "+ New quotation" button on each client card in
   * /quotation so the Designer opens with the client already locked in.
   */
  folder?: string;
}

export default async function DesignerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Kick off the (raced, short-budget) settings fetch immediately so its
  // TCP handshake to Supabase overlaps with the local JWT verification and
  // searchParams resolution. By the time we await it below it's almost
  // always already settled. `getAppSettings()` has its own timeout so it
  // never blocks the render for more than ~400 ms regardless of DB state.
  const settingsPromise = getAppSettings();

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;

  // ── Edit mode: let the browser fetch the row ────────────────────────────
  // The previous implementation did `ensureSchema()` + `select * from
  // quotations ...` inside this render function. On a cold Supabase
  // pooler that could sit for ~20 s, freezing the Next.js `loading.tsx`
  // skeleton in place with no timeout, no retry, and no way out — exactly
  // the "stuck on loading when I press Edit" complaint. Mirroring the
  // /quotation viewer, we now hand the id off to a client shell that
  // calls `/api/quotations?id=<n>` on mount with its own abort budget.
  // The API route still enforces ownership, so access control is intact.
  if (sp.id) {
    const quotationId = Number(sp.id);
    if (!Number.isFinite(quotationId) || quotationId <= 0) {
      return (
        <div className="min-h-screen bg-magic-soft/40">
          <TopBar user={user} />
          <main className="max-w-7xl mx-auto p-6">
            <p className="text-sm text-magic-ink/70">Quotation not found.</p>
          </main>
        </div>
      );
    }
    const appSettings = await settingsPromise;
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <TopBar user={user} />
        <main className="max-w-7xl mx-auto p-6">
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-magic-ink">
              Editing quotation #{quotationId}
            </h1>
            <p className="text-sm text-magic-ink/70">
              Edit the quotation below. Changes are saved when you click Save
              updates.
            </p>
          </header>
          <DesignerShell
            user={user}
            quotationId={quotationId}
            appSettings={appSettings}
          />
        </main>
      </div>
    );
  }

  let initialFolderId: number | null = null;
  if (sp.folder) {
    const n = Number(sp.folder);
    if (Number.isFinite(n) && n > 0) initialFolderId = n;
  }

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-magic-ink">
            Quotation Designer
          </h1>
          <p className="text-sm text-magic-ink/70">
            Build and edit your quotation. Choose a pricing category, modify
            the table, and save when ready.
          </p>
        </header>
        <Designer
          user={user}
          initialFolderId={initialFolderId}
          appSettings={await settingsPromise}
        />
      </main>
    </div>
  );
}
