import TopBarSkeleton from "@/components/TopBarSkeleton";
import Spinner from "@/components/Spinner";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-7 w-64 animate-pulse rounded bg-magic-soft" />
          <Spinner size={16} label="Loading dashboard…" />
        </div>
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-magic-border bg-white" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="h-64 animate-pulse rounded-2xl border border-magic-border bg-white" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="h-52 animate-pulse rounded-2xl border border-magic-border bg-white" />
              <div className="h-52 animate-pulse rounded-2xl border border-magic-border bg-white" />
            </div>
          </div>
          <div className="h-[560px] animate-pulse rounded-2xl border border-magic-border bg-white lg:col-span-1" />
        </div>
      </main>
    </div>
  );
}
