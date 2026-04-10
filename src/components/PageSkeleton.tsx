/**
 * Lightweight loading skeletons shown during page transitions. Keeps the
 * Top Bar outline visible so navigation feels instant while the real route
 * finishes its server-side work.
 */
export function TopBarSkeleton() {
  return (
    <header className="border-b border-magic-border bg-white">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-magic-red">Magic</span>
          <span className="text-xl font-black text-magic-ink">Tech</span>
          <span className="ml-2 text-xs text-magic-ink/50">
            Quotation Designer
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-3 w-16 rounded bg-magic-soft animate-pulse" />
          <div className="h-3 w-16 rounded bg-magic-soft animate-pulse" />
          <div className="h-3 w-16 rounded bg-magic-soft animate-pulse" />
          <div className="h-3 w-16 rounded bg-magic-soft animate-pulse" />
        </div>
      </div>
    </header>
  );
}

export function PageSkeleton({
  title = "Loading…",
  blocks = 4,
}: {
  title?: string;
  blocks?: number;
}) {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <div className="h-7 w-56 rounded bg-magic-border/60 animate-pulse mb-2" />
          <div className="h-4 w-80 rounded bg-magic-border/40 animate-pulse" />
          <span className="sr-only">{title}</span>
        </header>
        <div className="space-y-3">
          {Array.from({ length: blocks }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-xl border border-magic-border bg-white animate-pulse"
            />
          ))}
        </div>
      </main>
    </div>
  );
}
