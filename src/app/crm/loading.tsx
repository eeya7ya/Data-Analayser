import TopBarSkeleton from "@/components/TopBarSkeleton";
import Spinner from "@/components/Spinner";

export default function CrmLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="h-7 w-24 animate-pulse rounded bg-magic-soft" />
          <Spinner size={16} label="Loading CRM…" />
        </div>
        <div className="h-12 animate-pulse rounded-2xl border border-magic-border bg-white" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-44 animate-pulse rounded-2xl border border-magic-border bg-white" />
          <div className="h-44 animate-pulse rounded-2xl border border-magic-border bg-white" />
        </div>
      </main>
    </div>
  );
}
