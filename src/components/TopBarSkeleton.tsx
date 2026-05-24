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
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="h-9 w-[68px] rounded-xl border border-magic-border/70 bg-white/70" />
          <Image
            src="/logo.png"
            alt="Magic Tech"
            width={680}
            height={200}
            priority
            className="h-9 w-auto object-contain"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="h-9 w-9 rounded-full border border-magic-border/60 bg-white/60" />
          <span className="h-6 w-28 rounded-full bg-magic-soft/60 animate-pulse" />
          <span className="h-7 w-20 rounded-xl bg-magic-ink/80" />
        </div>
      </div>
    </header>
  );
}
