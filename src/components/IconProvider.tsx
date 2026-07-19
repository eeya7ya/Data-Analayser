"use client";

import { IconContext } from "@phosphor-icons/react";

/**
 * Sets the app-wide default look for every Phosphor icon (see src/lib/icons.ts).
 *
 * `weight` is the single knob for how the whole icon set reads:
 *   "thin" | "light" | "regular" | "bold" | "fill" | "duotone"
 * We use "duotone" — a filled primary shape plus a soft secondary layer — for a
 * richer, clearly-designed look that reads as intentional rather than a generic
 * line set. Individual icons can still override it with their own `weight` prop.
 *
 * This is a Client Component so it can hold the React context; it renders its
 * (server or client) children through untouched, so wrapping the whole app in
 * the root layout is free.
 */
export default function IconProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <IconContext.Provider value={{ weight: "duotone" }}>
      {children}
    </IconContext.Provider>
  );
}
