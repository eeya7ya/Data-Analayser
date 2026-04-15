import Image from "next/image";

/**
 * Static, no-DB, no-auth version of <TopBar /> used by every loading.tsx
 * boundary. Keeping the header in place during navigation stops the whole
 * page from visibly jumping while the real server component finishes
 * rendering — the user gets an instant response instead of staring at the
 * previous page for a couple of seconds.
 */
export default function TopBarSkeleton() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-white/70 backdrop-blur-xl shadow-[0_1px_0_rgba(17,24,39,0.04),0_10px_30px_-20px_rgba(17,24,39,0.25)]">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Magic Tech"
            width={680}
            height={200}
            priority
            className="h-9 w-auto object-contain"
          />
          <span className="hidden sm:inline-block rounded-full bg-gradient-to-r from-magic-red/10 to-magic-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-magic-red/80">
            Quotation Designer
          </span>
        </div>
        <nav className="flex items-center gap-2 text-sm">
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
