import TopBarSkeleton from "@/components/TopBarSkeleton";
import PageLoader from "@/components/PageLoader";

export default function FinancialProposalLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        <PageLoader fullScreen label="Loading financial proposal…" />
      </main>
    </div>
  );
}
