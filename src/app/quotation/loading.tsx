import TopBarSkeleton from "@/components/TopBarSkeleton";

/**
 * Rendered instantly by Next.js the moment the user clicks any link that
 * lands on /quotation, while the server component waits on Supabase. Before
 * this file existed the browser would sit on the *previous* page for up to
 * ~2.5s on a cold pooler — the main reason navigation felt broken.
 */
export default function QuotationLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-7 w-64 rounded bg-magic-soft animate-pulse" />
          <div className="h-8 w-40 rounded-md bg-magic-soft animate-pulse" />
        </div>
        <div className="mb-4 flex items-center gap-2 border-b border-magic-border">
          <div className="h-8 w-44 rounded-t bg-magic-soft/60 animate-pulse" />
          <div className="h-8 w-20 rounded-t bg-magic-soft/30 animate-pulse" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-magic-border bg-white"
            >
              <div className="flex items-center gap-3 p-4">
                <div className="h-5 w-5 rounded bg-magic-soft animate-pulse" />
                <div className="h-5 w-48 rounded bg-magic-soft animate-pulse" />
                <div className="ml-auto h-4 w-20 rounded bg-magic-soft animate-pulse" />
              </div>
              <div className="border-t border-magic-border px-4 py-3 space-y-2">
                {[0, 1].map((j) => (
                  <div key={j} className="flex items-center gap-4">
                    <div className="h-4 w-24 rounded bg-magic-soft animate-pulse" />
                    <div className="h-4 w-40 rounded bg-magic-soft animate-pulse" />
                    <div className="h-4 w-32 rounded bg-magic-soft animate-pulse" />
                    <div className="ml-auto h-4 w-16 rounded bg-magic-soft animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
