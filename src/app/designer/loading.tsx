import TopBarSkeleton from "@/components/TopBarSkeleton";

/**
 * Instant skeleton for /designer. Without this, clicking "Designer" in the
 * top bar froze the previous page while the server fetched the quotation +
 * app settings.
 */
export default function DesignerLoading() {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBarSkeleton />
      <main className="max-w-7xl mx-auto p-6">
        <header className="mb-6">
          <div className="h-7 w-72 rounded bg-magic-soft animate-pulse" />
          <div className="mt-2 h-4 w-96 rounded bg-magic-soft animate-pulse" />
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border border-magic-border bg-white p-4">
              <div className="h-5 w-40 rounded bg-magic-soft animate-pulse" />
              <div className="mt-4 space-y-2">
                <div className="h-10 rounded bg-magic-soft animate-pulse" />
                <div className="h-10 rounded bg-magic-soft animate-pulse" />
                <div className="h-10 rounded bg-magic-soft animate-pulse" />
              </div>
            </div>
            <div className="rounded-2xl border border-magic-border bg-white p-4">
              <div className="h-5 w-32 rounded bg-magic-soft animate-pulse" />
              <div className="mt-4 space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-8 rounded bg-magic-soft animate-pulse"
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-magic-border bg-white p-4">
            <div className="h-5 w-24 rounded bg-magic-soft animate-pulse" />
            <div className="mt-4 space-y-2">
              <div className="h-4 rounded bg-magic-soft animate-pulse" />
              <div className="h-4 rounded bg-magic-soft animate-pulse" />
              <div className="h-4 w-2/3 rounded bg-magic-soft animate-pulse" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
