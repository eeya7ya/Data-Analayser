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

  function applyMarker(prefix: string, suffix: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const inner = selected || "text";
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = before + prefix + inner + suffix + after;
    onChange(next);
    // Re-select the inner text so consecutive clicks (e.g. bold then
    // colour) chain naturally and an empty selection lands the cursor
    // on the placeholder word ready to be typed over.
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      const innerStart = before.length + prefix.length;
      ref.current.setSelectionRange(innerStart, innerStart + inner.length);
    });
  }

  // The pop-out cell (cell-input on focus) is absolutely positioned
  // relative to the surrounding <td>. The toolbar lives *inside* this
  // wrapper at z-20 so it sits above the cell pop-out (z-10) and
  // doesn't get clipped by the column's narrow width.
  const sharedHandlers = {
    onFocus: () => setFocused(true),
    // Delay the unfocus so a click on the toolbar (which momentarily
    // takes focus away) doesn't dismiss it before the click handler
    // runs. onMouseDown on the toolbar also calls preventDefault to
    // keep focus on the input, but the safety-net timeout makes the
    // UX feel reliable across browsers.
    onBlur: () => window.setTimeout(() => setFocused(false), 150),
  };

  return (
    <>
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
          className="no-print absolute -top-7 left-0 z-20 flex items-center gap-0.5 rounded-md border border-magic-border bg-white px-1 py-0.5 shadow-sm"
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
        </div>
      )}
    </>
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
      onClick={props.onClick}
      title={props.title}
      className={`h-5 min-w-[1.25rem] px-1 rounded text-[11px] leading-none hover:bg-magic-soft transition-colors ${props.extraClass ?? ""}`}
      style={props.extraStyle}
    >
      {props.label}
    </button>
  );
}
