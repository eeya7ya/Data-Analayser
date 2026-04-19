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
  /**
   * Pre-attribute the new quotation to a specific person at the company.
   * Sent by the "+ New quotation" button next to each contact on
   * /crm/companies/[id] so each person's card lists their own deals.
   */
  contact?: string;
  /**
   * Opt-out flag for the server-side "no folder → /quotation" gate.
   * Sent by the in-designer "+ New quotation" button so the user can
   * land on a clean create-mode hero and pick a client from there,
   * instead of being bounced back to the quotation list.
   */
  new?: string;
}

export default async function DesignerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Kick off the settings fetch immediately so its TCP handshake to
  // Supabase overlaps with the local JWT verification and searchParams
  // resolution. By the time we await it below it's almost always already
  // settled.
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
          <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
            <p className="text-sm text-magic-ink/70">Quotation not found.</p>
          </main>
        </div>
      );
    }
    const appSettings = await settingsPromise;
    return (
      <div className="min-h-screen bg-magic-soft/40 print-root">
        <div className="no-print">
          <TopBar user={user} />
        </div>
        <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10 print-main">
          <header className="mb-6 no-print">
            <h1 className="text-2xl font-bold text-magic-ink">
              Editing quotation #{quotationId}
            </h1>
            <p className="text-sm text-magic-ink/70">
              Edit the quotation below. Changes are saved when you click Save
              updates.
            </p>
          </header>
          {/* `key={quotationId}` forces a full remount when the user
              navigates between two saved quotations (e.g.
              /designer?id=32 → /designer?id=33). Without the key, the
              same DesignerShell instance re-ran its fetch effect but
              the `hasLoadedOnceRef` guard suppressed the blocking
              spinner, so the Designer kept rendering the previous
              quotation's `existing` data under the new "Editing
              quotation #<id>" header until the new fetch resolved. The
              remount clears that stale state and the spinner blocks
              the stale render. Post-save `reloadTick` bumps still
              share the same key, so edit-mode re-fetches stay
              silent — the Designer doesn't unmount mid-edit. */}
          <DesignerShell
            key={quotationId}
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

  let initialContactId: number | null = null;
  if (sp.contact) {
    const n = Number(sp.contact);
    if (Number.isFinite(n) && n > 0) initialContactId = n;
  }

  // Gate: the Designer can only be opened from a client (`?folder=<n>`),
  // an existing quotation (`?id=<n>`), or the explicit "+ New quotation"
  // button inside the Designer itself (`?new=1`). Attempting to reach
  // /designer directly redirects to the Clients & Quotations page so the
  // user must pick a client/quotation first. The `?new=1` opt-out lets
  // the in-designer button land on a clean create-mode hero where the
  // user picks a client without first bouncing through /quotation.
  if (!initialFolderId && !sp.new) {
    redirect("/quotation");
  }

  return (
    <div className="min-h-screen bg-magic-soft/40 print-root">
      <div className="no-print">
        <TopBar user={user} />
      </div>
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10 print-main">
        <header className="mb-6 no-print">
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
          initialContactId={initialContactId}
          appSettings={await settingsPromise}
        />
      </main>
    </div>
  );
}
