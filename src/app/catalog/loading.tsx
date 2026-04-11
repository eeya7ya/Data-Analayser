import TopBarSkeleton from "@/components/TopBarSkeleton";

export default function CatalogLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <div className="h-7 w-56 rounded bg-magic-soft animate-pulse" />
          <div className="mt-2 h-4 w-[32rem] max-w-full rounded bg-magic-soft animate-pulse" />
        </header>
        <div className="rounded-2xl border border-magic-border bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-56 rounded bg-magic-soft animate-pulse" />
            <div className="h-9 w-40 rounded bg-magic-soft animate-pulse" />
            <div className="ml-auto h-9 w-28 rounded bg-magic-soft animate-pulse" />
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-magic-border">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-magic-border px-3 py-2 last:border-b-0"
              >
                <div className="h-4 w-20 rounded bg-magic-soft animate-pulse" />
                <div className="h-4 w-40 rounded bg-magic-soft animate-pulse" />
                <div className="h-4 flex-1 rounded bg-magic-soft animate-pulse" />
                <div className="h-4 w-16 rounded bg-magic-soft animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
