"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

/**
 * The app's dropdown.
 *
 * A native `<select>` hands its option list to the operating system: on
 * Windows/Chrome that's a flat white box with blue text and a grey highlight
 * bar, on macOS something else entirely, and on none of them can it be styled,
 * padded, rounded or given the brand's focus ring. Every list in the product
 * looked like a 1998 form control while the surrounding UI didn't.
 *
 * This renders the trigger as a button and the list as a portal-mounted
 * listbox, so it looks identical on every platform and matches the rest of the
 * design system (rounded panel, soft shadow, red selection, hover state).
 *
 * It is a drop-in for `<select>`: pass the same `<option>` (and `<optgroup>`)
 * children and the same `value`, with `onChange` receiving the chosen value
 * directly instead of a DOM event.
 *
 *   <Select value={sort} onChange={(v) => setSort(v as SortKey)}>
 *     <option value="newest">Newest first</option>
 *     <option value="oldest">Oldest first</option>
 *   </Select>
 *
 * Behaviour kept from the native control: keyboard operation (arrows, Home /
 * End, Enter, Escape, type-ahead), `disabled` options, and closing on outside
 * click or scroll-away. The list is portalled to <body> so a dropdown inside a
 * modal, a table cell, or any `overflow-hidden` card is never clipped.
 */

interface OptionItem {
  kind: "option";
  value: string;
  label: ReactNode;
  /** Flattened text of `label`, used by the trigger and for type-ahead. */
  text: string;
  disabled: boolean;
}

interface GroupItem {
  kind: "group";
  label: string;
}

type Item = OptionItem | GroupItem;

/** Flatten a label node down to plain text (for the trigger + type-ahead). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Walk `<option>` / `<optgroup>` children (through fragments and arrays). */
function collectItems(children: ReactNode, out: Item[] = []): Item[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "optgroup") {
      const props = child.props as { label?: string; children?: ReactNode };
      out.push({ kind: "group", label: props.label ?? "" });
      collectItems(props.children, out);
      return;
    }
    if (child.type === "option") {
      const props = child.props as {
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      };
      const label = props.children;
      out.push({
        kind: "option",
        value: String(props.value ?? ""),
        label,
        text: textOf(label),
        disabled: Boolean(props.disabled),
      });
      return;
    }
    // Fragments / wrappers: recurse so `<>…</>` and mapped arrays work.
    const props = child.props as { children?: ReactNode } | undefined;
    if (props?.children) collectItems(props.children, out);
  });
  return out;
}

interface PopupPosition {
  left: number;
  width: number;
  maxHeight: number;
  /** Exactly one of these is set, depending on which way the list opens. */
  top?: number;
  bottom?: number;
}

const LIST_MAX_HEIGHT = 288; // px — ~8 rows before the list scrolls
const LIST_MIN_WIDTH = 176; // px — long labels stay readable under a tiny trigger
const VIEWPORT_MARGIN = 8;

export default function Select({
  value,
  onChange,
  children,
  className,
  disabled = false,
  title,
  id,
  name,
  placeholder = "Select…",
  "aria-label": ariaLabel,
}: {
  value: string | number | null | undefined;
  onChange: (value: string) => void;
  /** `<option>` / `<optgroup>` elements, exactly as a native select takes. */
  children: ReactNode;
  /** Extra classes for the trigger. Merged last, so they win over the base. */
  className?: string;
  disabled?: boolean;
  title?: string;
  id?: string;
  /** Mirrors the choice into a hidden input for plain HTML form posts. */
  name?: string;
  /** Shown when `value` matches no option (the native "blank" state). */
  placeholder?: string;
  "aria-label"?: string;
}) {
  const items = useMemo(() => collectItems(children), [children]);
  const options = useMemo(
    () => items.filter((i): i is OptionItem => i.kind === "option"),
    [items],
  );
  const current = String(value ?? "");
  const selected = options.find((o) => o.value === current) ?? null;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<PopupPosition | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });
  const listboxId = useId();

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - VIEWPORT_MARGIN;
    const above = r.top - VIEWPORT_MARGIN;
    // Flip up only when there genuinely isn't room below and there is above —
    // a dropdown near the bottom of the viewport otherwise opens off-screen.
    const openUp = below < 180 && above > below;
    const width = Math.max(r.width, LIST_MIN_WIDTH);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, r.left),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    setPosition({
      left,
      width,
      maxHeight: Math.max(140, Math.min(LIST_MAX_HEIGHT, openUp ? above : below)),
      ...(openUp
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
    });
  }, []);

  // Keep the list glued to its trigger while the page moves under it. `true`
  // captures scrolls inside nested containers (modals, tables), not just window.
  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => measure();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, measure]);

  // Outside click / Escape close. Pointerdown (not click) so the list closes
  // before another control's click handler runs.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // The list lives in a portal at <body>, so it is "outside" every menu and
  // popover that closes itself on a document-level mousedown (the row-actions
  // menu in QuotationPreview, for one). Left alone, picking an option would
  // tear the surrounding menu down on mousedown and the click would never land.
  // Stopping the event at the list element keeps it from reaching those
  // document listeners at all; capture-phase listeners (including this
  // component's own outside-click handler) still see it.
  useEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    const swallow = (e: Event) => e.stopPropagation();
    el.addEventListener("pointerdown", swallow);
    el.addEventListener("mousedown", swallow);
    return () => {
      el.removeEventListener("pointerdown", swallow);
      el.removeEventListener("mousedown", swallow);
    };
  }, [open, position]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const openList = useCallback(() => {
    if (disabled) return;
    const start = options.findIndex((o) => o.value === current && !o.disabled);
    setActiveIndex(start >= 0 ? start : options.findIndex((o) => !o.disabled));
    // Measure BEFORE opening so the list mounts already positioned — it never
    // flashes at 0,0, and the effects below always find a live list element on
    // the very first render of the popup.
    measure();
    setOpen(true);
  }, [disabled, options, current, measure]);

  const commit = useCallback(
    (option: OptionItem) => {
      if (option.disabled) return;
      setOpen(false);
      triggerRef.current?.focus();
      if (option.value !== current) onChange(option.value);
    },
    [current, onChange],
  );

  /** Step to the next selectable option, skipping disabled ones. */
  const step = useCallback(
    (from: number, delta: number) => {
      if (options.length === 0) return -1;
      let i = from;
      for (let n = 0; n < options.length; n++) {
        i = i + delta;
        if (i < 0) i = 0;
        if (i > options.length - 1) i = options.length - 1;
        if (!options[i].disabled) return i;
        if ((delta < 0 && i === 0) || (delta > 0 && i === options.length - 1)) {
          return from;
        }
      }
      return from;
    },
    [options],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (!open) {
        if (
          e.key === "Enter" ||
          e.key === " " ||
          e.key === "ArrowDown" ||
          e.key === "ArrowUp"
        ) {
          e.preventDefault();
          openList();
        }
        return;
      }
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        case "Tab":
          setOpen(false);
          return;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => step(i < 0 ? -1 : i, 1));
          return;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => step(i < 0 ? options.length : i, -1));
          return;
        case "Home":
          e.preventDefault();
          setActiveIndex(step(-1, 1));
          return;
        case "End":
          e.preventDefault();
          setActiveIndex(step(options.length, -1));
          return;
        case "Enter":
        case " ": {
          e.preventDefault();
          const option = options[activeIndex];
          if (option) commit(option);
          return;
        }
        default:
          break;
      }
      // Type-ahead: letters jump to the first option starting with what was
      // typed, matching how a native select behaves.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const now = Date.now();
        const state = typeAhead.current;
        state.buffer = now - state.at > 700 ? e.key : state.buffer + e.key;
        state.at = now;
        const needle = state.buffer.toLowerCase();
        const hit = options.findIndex(
          (o) => !o.disabled && o.text.toLowerCase().startsWith(needle),
        );
        if (hit >= 0) setActiveIndex(hit);
      }
    },
    [disabled, open, openList, options, activeIndex, commit, step],
  );

  const triggerLabel = selected ? selected.label : placeholder;
  const isPlaceholder = !selected || selected.text.trim() === "";

  // Index of each option within `options`, so the rendered rows (which may be
  // interleaved with group headers) can point at the right entry.
  let optionCursor = -1;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
        }
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        title={title}
        disabled={disabled}
        data-select-trigger=""
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={twMerge(
          "inline-flex min-w-[4rem] items-center justify-between gap-2 rounded-lg border border-magic-border bg-white px-3 py-2 text-left text-sm text-magic-ink shadow-sm transition-colors hover:border-magic-ink/25 focus:border-magic-red focus:outline-none focus:ring-2 focus:ring-magic-red/25 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span
          className={twMerge(
            "min-w-0 flex-1 truncate",
            isPlaceholder ? "text-magic-ink/40" : "",
          )}
        >
          {triggerLabel}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          aria-hidden="true"
          data-select-chevron=""
          className={`h-3.5 w-3.5 shrink-0 text-magic-ink/40 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            data-select-popup=""
            onKeyDown={onKeyDown}
            style={{
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
              ...(position.top !== undefined ? { top: position.top } : {}),
              ...(position.bottom !== undefined
                ? { bottom: position.bottom }
                : {}),
            }}
            className="no-print fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-magic-border bg-white py-1 text-sm shadow-mt-lift ring-1 ring-magic-ink/5"
          >
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-magic-ink/45">
                Nothing to choose from
              </p>
            )}
            {items.map((item, i) => {
              if (item.kind === "group") {
                return (
                  <p
                    key={`g-${i}`}
                    role="presentation"
                    className="mt-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-magic-ink/40 first:mt-0"
                  >
                    {item.label}
                  </p>
                );
              }
              optionCursor += 1;
              const index = optionCursor;
              const isSelected = item.value === current;
              const isActive = index === activeIndex;
              return (
                <button
                  key={`o-${index}`}
                  id={`${listboxId}-opt-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-index={index}
                  disabled={item.disabled}
                  onMouseEnter={() => !item.disabled && setActiveIndex(index)}
                  onClick={() => commit(item)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    isSelected
                      ? "font-semibold text-magic-red"
                      : "text-magic-ink"
                  } ${isActive && !item.disabled ? "bg-magic-header" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {isSelected && (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
