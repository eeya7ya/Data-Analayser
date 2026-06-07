import TopBarSkeleton from "@/components/TopBarSkeleton";
import PageLoader from "@/components/PageLoader";

/**
 * Rendered instantly by Next.js the moment the user clicks any link that
 * lands on /quotation, while the server component waits on Supabase. Before
 * this file existed the browser would sit on the *previous* page for up to
 * ~2.5s on a cold pooler — the main reason navigation felt broken.
 */
export default function QuotationLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <PageLoader fullScreen label="Loading quotations…" />
      </main>
    </div>
  );
}
