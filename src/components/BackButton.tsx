"use client";

import { useRouter } from "next/navigation";

/**
 * Renders a back link that pops the browser history when there's
 * something to go back to, and otherwise navigates to a sensible
 * fallback URL. Using `router.back()` keeps the user in the flow they
 * came from instead of yanking them up to a fixed hub page.
 */
export default function BackButton({
  fallbackHref,
  fallbackLabel,
  className,
}: {
  fallbackHref: string;
  fallbackLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const baseClass =
    "inline-flex items-center gap-1 text-xs text-magic-ink/60 hover:text-magic-red transition-colors";
  return (
    <button
      type="button"
      onClick={() => {
        // history.length is at least 1 (the current entry). >1 means
        // there's an actual previous page to pop back to. SSR guard
        // keeps this safe when called during render.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={className ? `${baseClass} ${className}` : baseClass}
    >
      ← {fallbackLabel}
    </button>
  );
}
