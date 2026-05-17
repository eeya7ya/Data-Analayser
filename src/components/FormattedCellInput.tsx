"use client";

import { useRef, useState } from "react";

/**
 * An editable cell with a floating mini-toolbar (B / highlight / red /
 * blue / green / orange) that lets the user style the selected text
 * without typing the marker syntax by hand. The markers themselves
 * remain in the underlying string — same lightweight format used by
 * `renderRichCell` on the non-edit / printed view — so saving,
 * pasting, and round-tripping stay plain text.
 *
 * Usage:
 *   <FormattedCellInput
 *     value={item.brand}
 *     onChange={(v) => onUpdate(i, { brand: v })}
 *     inputClassName="cell-input text-center"
 *   />
 *
 *   <FormattedCellInput
 *     as="textarea"
 *     rows={3}
 *     value={item.description}
 *     onChange={(v) => onUpdate(i, { description: v })}
 *     inputClassName="description-input w-full bg-transparent text-[10.5px]"
 *   />
 *
 * Number columns (quantity / unit price) intentionally stay as plain
 * <input type="number">, because mixing marker syntax into a number
 * field would corrupt the value on every keystroke.
 */
export function FormattedCellInput(props: {
  value: string;
  onChange: (next: string) => void;
  as?: "input" | "textarea";
  rows?: number;
  inputClassName?: string;
  placeholder?: string;
  title?: string;
}) {
  const {
    value,
    onChange,
    as = "input",
    rows,
    inputClassName,
    placeholder,
    title,
  } = props;
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [focused, setFocused] = useState(false);
  // Remember the last selection range the user made inside the input.
  // We can't rely on reading it off `ref.current` at toolbar-click time:
  // even with mousedown preventDefault, some browsers (notably mobile
  // Safari) still drop the selection when another element receives a
  // mouse event, which used to make the marker insert at value.length
  // — the visible "nothing happened" bug.
  const selectionRef = useRef<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  function rememberSelection() {
    const el = ref.current;
    if (!el) return;
    selectionRef.current = {
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
    };
  }

  function applyMarker(prefix: string, suffix: string) {
    const el = ref.current;
    if (!el) return;
    // Prefer the remembered selection over re-reading it now — the
    // mousedown handler on the toolbar buttons keeps focus on the
    // input in most browsers, but the underlying selection range can
    // still get cleared between mousedown and click on some engines.
    const start = selectionRef.current.start;
    const end = selectionRef.current.end;
    const selected = value.slice(start, end);
    const inner = selected || "text";
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = before + prefix + inner + suffix + after;
    onChange(next);
    // Re-select the inner text so consecutive clicks (e.g. bold then
    // colour) chain naturally and an empty selection lands the cursor
    // on the placeholder word ready to be typed over.
    const innerStart = before.length + prefix.length;
    const innerEnd = innerStart + inner.length;
    selectionRef.current = { start: innerStart, end: innerEnd };
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      ref.current.setSelectionRange(innerStart, innerEnd);
    });
  }

  // We keep the toolbar visible across very short blur/focus blips
  // (clicking a toolbar button can briefly steal focus on some
  // engines). The timeout ID lets `onFocus` cancel a pending hide so
  // the toolbar doesn't flicker out and back in — which used to drag
  // the absolutely-positioned `description-input` cell back to its
  // inline size for a frame, producing the "row rapidly goes up and
  // down" bug.
  const blurTimer = useRef<number | null>(null);
  const sharedHandlers = {
    onFocus: () => {
      if (blurTimer.current != null) {
        window.clearTimeout(blurTimer.current);
        blurTimer.current = null;
      }
      setFocused(true);
    },
    onBlur: () => {
      if (blurTimer.current != null) window.clearTimeout(blurTimer.current);
      blurTimer.current = window.setTimeout(() => {
        blurTimer.current = null;
        setFocused(false);
      }, 200);
    },
    onSelect: rememberSelection,
    onKeyUp: rememberSelection,
    onMouseUp: rememberSelection,
  };

  return (
    // Wrap input + toolbar in a position:relative shell so the toolbar
    // anchors to *this* component, not to whatever ancestor happens to
    // be position:relative. Without this the toolbar latches onto the
    // surrounding <td>, which is fine until the description textarea
    // pops out to absolute on focus — at that point the toolbar floats
    // off above the wrong slot and the cell appears to jump.
    <span className="relative block">
      {as === "textarea" ? (
        <textarea
          ref={(el) => {
            ref.current = el;
          }}
          rows={rows ?? 3}
          value={value}
          placeholder={placeholder}
          title={title}
          className={inputClassName}
          onChange={(e) => onChange(e.target.value)}
          {...sharedHandlers}
        />
      ) : (
        <input
          ref={(el) => {
            ref.current = el;
          }}
          value={value}
          placeholder={placeholder}
          title={title}
          className={inputClassName}
          onChange={(e) => onChange(e.target.value)}
          {...sharedHandlers}
        />
      )}
      {focused && (
        <div
          className="no-print absolute -top-7 left-0 z-20 flex items-center gap-1 rounded-md border border-magic-border bg-white px-1 py-0.5 shadow-sm"
          // Belt-and-braces: the wrapper preventDefault catches clicks
          // that land between buttons, each button also calls
          // preventDefault on its own mousedown.
          onMouseDown={(e) => e.preventDefault()}
        >
          <ToolbarButton
            label="B"
            title="Bold (wraps selection in **…**)"
            onClick={() => applyMarker("**", "**")}
            extraClass="font-bold"
          />
          <ToolbarButton
            label="M"
            title="Highlight (wraps selection in ==…==)"
            onClick={() => applyMarker("==", "==")}
            extraStyle={{ background: "#fff3a3" }}
          />
          <ToolbarButton
            label="A"
            title="Red"
            onClick={() => applyMarker("[red]", "[/red]")}
            extraStyle={{ color: "#c1272d" }}
          />
          <ToolbarButton
            label="A"
            title="Blue"
            onClick={() => applyMarker("[blue]", "[/blue]")}
            extraStyle={{ color: "#1d4ed8" }}
          />
          <ToolbarButton
            label="A"
            title="Green"
            onClick={() => applyMarker("[green]", "[/green]")}
            extraStyle={{ color: "#15803d" }}
          />
          <ToolbarButton
            label="A"
            title="Orange"
            onClick={() => applyMarker("[orange]", "[/orange]")}
            extraStyle={{ color: "#c2410c" }}
          />
          {/* Inline preview of the rich-rendered value so the user
              gets immediate visual confirmation that B / colour
              actually applied — the editable cell itself can only
              show the raw `**text**` markers, which used to look
              like the formatting had silently failed. */}
          {hasRichMarkers(value) && (
            <span className="ml-1 max-w-[18rem] truncate border-l border-magic-border pl-1 text-[10.5px] leading-none">
              {renderRich(value)}
            </span>
          )}
        </div>
      )}
    </span>
  );
}

function ToolbarButton(props: {
  label: string;
  title: string;
  onClick: () => void;
  extraClass?: string;
  extraStyle?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      // mousedown preventDefault stops the browser from shifting focus
      // off the input to this button. Without it the input briefly
      // blurs, the description-input cell collapses out of its focused
      // absolute layout, then snaps back when requestAnimationFrame
      // refocuses — the visible "rapid up and down" jitter.
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
      title={props.title}
      className={`h-5 min-w-[1.25rem] px-1 rounded text-[11px] leading-none hover:bg-magic-soft transition-colors ${props.extraClass ?? ""}`}
      style={props.extraStyle}
    >
      {props.label}
    </button>
  );
}

// ── Lightweight inline renderer for the toolbar preview ──────────────
// Mirrors the heavier `renderRichCell` in QuotationPreview but inlined
// here so this component stays standalone. Same marker grammar:
// **bold**, ==highlight==, [red|blue|green|orange]…[/red|…].
const PREVIEW_COLOR: Record<string, string> = {
  red: "#c1272d",
  blue: "#1d4ed8",
  green: "#15803d",
  orange: "#c2410c",
};
const RICH_PATTERN =
  /(\*\*[^*\n]+\*\*|==[^=\n]+==|\[(?:red|blue|green|orange)\][^[\n]+\[\/(?:red|blue|green|orange)\])/g;

function hasRichMarkers(text: string): boolean {
  if (!text) return false;
  RICH_PATTERN.lastIndex = 0;
  return RICH_PATTERN.test(text);
}

function renderRich(text: string): React.ReactNode {
  const parts = text.split(RICH_PATTERN);
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={i}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith("==") && part.endsWith("==")) {
      nodes.push(
        <mark
          key={i}
          style={{ background: "#fff3a3", color: "inherit", padding: "0 2px" }}
        >
          {part.slice(2, -2)}
        </mark>,
      );
    } else {
      const m = part.match(
        /^\[(red|blue|green|orange)\]([\s\S]+)\[\/(red|blue|green|orange)\]$/,
      );
      if (m && m[1] === m[3]) {
        nodes.push(
          <span key={i} style={{ color: PREVIEW_COLOR[m[1]] }}>
            {m[2]}
          </span>,
        );
      } else {
        nodes.push(part);
      }
    }
  }
  return <>{nodes}</>;
}
