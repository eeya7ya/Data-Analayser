"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";
import { HELP_TIPS, type HelpTipContent } from "@/lib/help/content";

/**
 * The inline "wondermark" — a small ⍰ marker placed next to a heading or
 * control anywhere in the app. Tapping it pops a short explanation of just
 * that area, so users can self-serve without leaving the page.
 *
 * Content comes from one of two places:
 *   • pass `id` to pull a centrally-defined entry from HELP_TIPS (preferred —
 *     keeps copy consistent and editable in one file), or
 *   • pass `title` + `body` inline for a one-off.
 *
 * The popover renders through a portal on document.body with a fixed
 * position computed from the marker, so it's never clipped by a card's
 * rounded/overflow bounds or a transformed ancestor. It closes on Escape,
 * on click-outside, and on scroll/resize (which would otherwise leave it
 * floating away from its marker).
 */
export default function HelpTip({
  id,
  title,
  body,
  label,
  className,
  size = "sm",
}: {
  /** Key into HELP_TIPS. When set, overrides inline title/body. */
  id?: string;
  /** Inline title (used when `id` is not given). */
  title?: string;
  /** Inline body (used when `id` is not given). */
  body?: string;
  /** Accessible label for the marker button; defaults to the tip title. */
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const content: HelpTipContent | null = id
    ? HELP_TIPS[id] ?? null
    : title
      ? { title, body: body ?? "" }
      : null;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  // Position the popover under the marker, nudged so it never spills off the
  // right edge on narrow screens.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const b = btnRef.current?.getBoundingClientRect();
      if (!b) return;
      const width = 288; // matches w-72 below
      const margin = 8;
      let left = b.left;
      if (left + width + margin > window.innerWidth) {
        left = window.innerWidth - width - margin;
      }
      if (left < margin) left = margin;
      setPos({ top: b.bottom + 8, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Close on Escape and on click outside the marker + popover.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!content) return null;

  const dim = size === "md" ? "h-5 w-5" : "h-4 w-4";
  const icon = size === "md" ? "h-3.5 w-3.5" : "h-3 w-3";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label || `Help: ${content.title}`}
        aria-expanded={open}
        title={content.title}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className={`inline-flex ${dim} shrink-0 items-center justify-center rounded-full border border-magic-border/70 bg-white/80 text-magic-ink/45 align-middle shadow-sm transition-colors hover:border-magic-red/40 hover:bg-magic-red/5 hover:text-magic-red focus:outline-none focus-visible:ring-2 focus-visible:ring-magic-red/40 ${
          open ? "border-magic-red/40 bg-magic-red/5 text-magic-red" : ""
        } ${className || ""}`}
      >
        <HelpCircle className={icon} strokeWidth={2.25} />
      </button>

      {mounted && open && pos
        ? createPortal(
            <div
              ref={popRef}
              role="dialog"
              aria-labelledby={titleId}
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-[70] w-72 max-w-[calc(100vw-16px)] rounded-2xl border border-magic-border bg-white p-4 text-left shadow-mt-lift"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <h4
                  id={titleId}
                  className="text-sm font-bold leading-snug text-magic-ink"
                >
                  {content.title}
                </h4>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setOpen(false)}
                  className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-magic-ink/40 hover:bg-magic-soft hover:text-magic-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[13px] leading-relaxed text-magic-ink/70">
                {content.body}
              </p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
