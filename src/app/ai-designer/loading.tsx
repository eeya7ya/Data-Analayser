import TopBarSkeleton from "@/components/TopBarSkeleton";
import Spinner from "@/components/Spinner";

export default function AIDesignerLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-screen-2xl mx-auto px-6 py-6 lg:px-10">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="h-7 w-72 rounded bg-magic-soft animate-pulse" />
            <Spinner size={16} label="Loading AI designer…" />
          </div>
          <div className="mt-2 h-4 w-[34rem] max-w-full rounded bg-magic-soft animate-pulse" />
        </header>
        <div className="rounded-2xl border border-magic-border bg-white p-6">
          <div className="h-5 w-48 rounded bg-magic-soft animate-pulse" />
          <div className="mt-4 h-10 rounded bg-magic-soft animate-pulse" />
          <div className="mt-3 h-24 rounded bg-magic-soft animate-pulse" />
          <div className="mt-4 h-10 w-40 rounded-md bg-magic-soft animate-pulse" />
        </div>
      </main>
    </div>
  );
}
