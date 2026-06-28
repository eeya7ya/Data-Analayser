import TopBarSkeleton from "@/components/TopBarSkeleton";
import PageLoader from "@/components/PageLoader";

/**
 * Route-level loading UI for the pipeline. The page server-component does role
 * resolution + ensureSchema before the client board mounts, so without this the
 * route showed a blank gap. Next renders this instantly on navigation.
 */
export default function PipelineLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <PageLoader fullScreen label="Loading your pipeline…" />
      </main>
    </div>
  );
}
