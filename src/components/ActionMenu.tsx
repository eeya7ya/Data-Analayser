"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reusable toolbar dropdown. Renders a single labelled trigger button
 * that opens a small menu of related actions, so groups of buttons that
 * do "the same kind of thing" (saving, exporting, importing…) collapse
 * into one control. Closes on outside click or Escape, matching the
 * MoveToFolder pattern used elsewhere.
 */

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  /** When true the item is not rendered at all (e.g. mode-gated). */
  hidden?: boolean;
}

export default function ActionMenu({
  label,
  items,
  variant = "primary",
  size = "sm",
  align = "right",
  disabled = false,
  title,
}: {
  label: string;
  items: ActionMenuItem[];
  /** Visual style of the trigger button. */
  variant?: "primary" | "outline";
  /** "sm" matches the Designer toolbar, "md" the viewer toolbar. */
  size?: "sm" | "md";
  /** Which edge the menu aligns to. */
  align?: "left" | "right";
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const visible = items.filter((it) => !it.hidden);
  if (visible.length === 0) return null;

  const sizeCls = size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs";
  const variantCls =
    variant === "primary"
      ? "bg-magic-red text-white hover:bg-red-700"
      : "border border-magic-red text-magic-red hover:bg-magic-red hover:text-white";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={title}
        className={`inline-flex items-center gap-1.5 rounded-md font-semibold transition-colors disabled:opacity-50 ${sizeCls} ${variantCls}`}
      >
        {label}
        <svg
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div
          className={`absolute z-50 mt-1 min-w-[12rem] rounded-md border border-magic-border bg-white py-1 text-sm shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {visible.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (it.disabled) return;
                setOpen(false);
                it.onClick();
              }}
              disabled={it.disabled}
              title={it.title}
              className="block w-full px-3 py-1.5 text-left font-medium text-magic-ink hover:bg-magic-header disabled:cursor-not-allowed disabled:opacity-40"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
