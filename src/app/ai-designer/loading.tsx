import TopBarSkeleton from "@/components/TopBarSkeleton";

export default function AIDesignerLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <div className="h-7 w-72 rounded bg-magic-soft animate-pulse" />
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
