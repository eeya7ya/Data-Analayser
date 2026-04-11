/**
 * Static, no-DB, no-auth version of <TopBar /> used by every loading.tsx
 * boundary. Keeping the header in place during navigation stops the whole
 * page from visibly jumping while the real server component finishes
 * rendering — the user gets an instant response instead of staring at the
 * previous page for a couple of seconds.
 */
export default function TopBarSkeleton() {
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
        <nav className="flex items-center gap-4 text-sm">
          <span className="h-4 w-16 rounded bg-magic-soft animate-pulse" />
          <span className="h-4 w-20 rounded bg-magic-soft animate-pulse" />
          <span className="h-4 w-20 rounded bg-magic-soft animate-pulse" />
          <span className="h-4 w-20 rounded bg-magic-soft animate-pulse" />
          <span className="h-6 w-16 rounded-md border border-magic-border bg-magic-soft/40" />
        </nav>
      </div>
    </header>
  );
}
