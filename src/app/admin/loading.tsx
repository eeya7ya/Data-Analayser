import TopBarSkeleton from "@/components/TopBarSkeleton";

export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-5xl mx-auto px-6 py-6 lg:px-10">
        <div className="mb-4 h-7 w-32 rounded bg-magic-soft animate-pulse" />
        <div className="mb-4 flex items-center gap-2 border-b border-magic-border">
          <div className="h-8 w-28 rounded-t bg-magic-soft/60 animate-pulse" />
          <div className="h-8 w-28 rounded-t bg-magic-soft/30 animate-pulse" />
          <div className="h-8 w-28 rounded-t bg-magic-soft/30 animate-pulse" />
        </div>
        <div className="space-y-3 rounded-2xl border border-magic-border bg-white p-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-4 w-40 rounded bg-magic-soft animate-pulse" />
              <div className="mt-2 h-9 rounded bg-magic-soft animate-pulse" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
