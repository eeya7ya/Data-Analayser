import TopBarSkeleton from "@/components/TopBarSkeleton";
import Spinner from "@/components/Spinner";

export default function HandoffsLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-7 w-44 animate-pulse rounded bg-magic-soft" />
          <Spinner size={16} label="Loading handoffs…" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-magic-border bg-white" />
          ))}
        </div>
      </main>
    </div>
  );
}
