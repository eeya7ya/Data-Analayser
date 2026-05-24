import { APP_VERSION_LABEL } from "@/lib/version";

/**
 * Fixed bottom status bar. Rendered once via the app chrome (TopBar) so
 * every page carries it. Thin and translucent so it never competes with
 * page content; `globals.css` reserves matching bottom padding on <body>
 * so nothing is hidden behind it.
 */
export default function AppFooter() {
  return (
    <footer className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-white/40 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-4 py-1.5 sm:px-6">
        <span className="text-[11px] font-medium text-magic-ink/50">
          MagicTech · Data &amp; Quotation Platform
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-magic-border/60 bg-white/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-magic-ink/55">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {APP_VERSION_LABEL}
        </span>
      </div>
    </footer>
  );
}
