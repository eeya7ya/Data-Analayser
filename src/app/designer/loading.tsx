import TopBarSkeleton from "@/components/TopBarSkeleton";
import PageLoader from "@/components/PageLoader";

/**
 * Instant skeleton for /designer. Without this, clicking "Designer" in the
 * top bar froze the previous page while the server fetched the quotation +
 * app settings.
 */
export default function DesignerLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <PageLoader fullScreen label="Loading the Designer…" />
      </main>
    </div>
  );
}
