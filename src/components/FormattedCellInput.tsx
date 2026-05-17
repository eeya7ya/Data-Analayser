"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Rich cell editor with WYSIWYG formatting. The B / highlight / colour
 * buttons apply real inline styling inside a contenteditable element
 * — what you see is what gets printed. Persistence still uses the
 * lightweight marker format (`**bold**`, `==highlight==`,
 * `[red]…[/red]`) so the rest of the app (renderRichCell in
 * QuotationPreview, the print pipeline, search indexers) keeps
 * working unchanged.
 *
 * Usage matches the previous textarea/input version:
 *   <FormattedCellInput
 *     as="textarea"
 *     rows={3}
 *     value={item.description}
 *     onChange={(v) => onUpdate(i, { description: v })}
 *     inputClassName="description-input w-full bg-transparent text-[10.5px]"
 *   />
 */

const RICH_COLOR_MAP: Record<string, string> = {
  red: "#c1272d",
  blue: "#1d4ed8",
  green: "#15803d",
  orange: "#c2410c",
};
const HIGHLIGHT_BG = "#fff3a3";

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

  const editorRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<number | null>(null);
  // The last value WE pushed to onChange. Used to avoid clobbering the
  // contenteditable on every re-render (which would jump the caret).
  const lastEmittedRef = useRef<string>(value);

  // Render the initial HTML once. Subsequent value changes only refresh
  // the DOM if the value came from outside (e.g. another component
  // resetting it) — otherwise the user's caret would jump every keystroke.
  // useState's lazy initializer guarantees this runs once on first render
  // and doesn't trip the exhaustive-deps lint that a useMemo([]) would.
  const [initialHtml] = useState(() => markersToHtml(value));

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (value === lastEmittedRef.current) return;
    // External update — repaint. Skip if the user is actively typing
    // (focused) to avoid stomping their caret mid-edit.
    if (document.activeElement === el) return;
    el.innerHTML = markersToHtml(value);
    lastEmittedRef.current = value;
  }, [value]);

  function emit() {
    const el = editorRef.current;
    if (!el) return;
    const markers = htmlToMarkers(el);
    lastEmittedRef.current = markers;
    onChange(markers);
  }

  function applyFormat(kind: "bold" | "highlight" | "red" | "blue" | "green" | "orange") {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    // execCommand is "deprecated" but every browser still ships it and
    // it's the most reliable cross-engine way to mutate a contenteditable
    // selection while preserving the caret. Safari/iOS in particular
    // gets cursor positioning wrong if we replace ranges manually.
    if (kind === "bold") {
      document.execCommand("bold");
    } else if (kind === "highlight") {
      // hiliteColor needs styleWithCSS for inline-style output instead
      // of deprecated <font> elements.
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("hiliteColor", false, HIGHLIGHT_BG);
    } else {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, RICH_COLOR_MAP[kind]);
    }
    emit();
  }

  const isTextarea = as === "textarea";
  // Tailwind classes the caller passes in (e.g. `description-input`,
  // `cell-input`). We forward them so the existing CSS popout / hover
  // behaviour keeps working — the contenteditable inherits the same
  // box-sizing, padding, and on-focus absolute positioning as the old
  // textarea/input did.
  const baseClass = inputClassName ?? "";
  // Min-height for textarea-flavour so an empty editor still has a
  // clickable surface area roughly matching the previous `rows={3}`.
  const minHeight = isTextarea ? `${(rows ?? 3) * 1.35}em` : undefined;

  return (
    <span className="relative block">
      <div
        ref={(el) => {
          editorRef.current = el;
        }}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={isTextarea}
        aria-label={placeholder}
        title={title}
        className={`${baseClass} formatted-cell-editor ${isTextarea ? "is-textarea" : "is-input"}`}
        style={minHeight ? { minHeight } : undefined}
        data-placeholder={placeholder ?? ""}
        onInput={emit}
        onBlur={() => {
          if (blurTimer.current != null) window.clearTimeout(blurTimer.current);
          blurTimer.current = window.setTimeout(() => {
            blurTimer.current = null;
            setFocused(false);
          }, 200);
          // Final sync on blur in case onInput missed anything (e.g.
          // a paste that came in just before).
          emit();
        }}
        onFocus={() => {
          if (blurTimer.current != null) {
            window.clearTimeout(blurTimer.current);
            blurTimer.current = null;
          }
          setFocused(true);
        }}
        onPaste={(e) => {
          // Force plain text on paste so a rich-formatted clipboard
          // payload from somewhere else doesn't smuggle in stray HTML
          // that our serializer can't represent as markers.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
      />
      {focused && (
        <div
          className="no-print absolute -top-7 left-0 z-20 flex items-center gap-1 rounded-md border border-magic-border bg-white px-1 py-0.5 shadow-sm"
          // Belt-and-braces preventDefault so a click in the toolbar
          // gap doesn't blur the editor and lose the selection.
          onMouseDown={(e) => e.preventDefault()}
        >
          <ToolbarButton
            label="B"
            title="Bold"
            onClick={() => applyFormat("bold")}
            extraClass="font-bold"
          />
          <ToolbarButton
            label="M"
            title="Highlight"
            onClick={() => applyFormat("highlight")}
            extraStyle={{ background: HIGHLIGHT_BG }}
          />
          <ToolbarButton
            label="A"
            title="Red"
            onClick={() => applyFormat("red")}
            extraStyle={{ color: RICH_COLOR_MAP.red }}
          />
          <ToolbarButton
            label="A"
            title="Blue"
            onClick={() => applyFormat("blue")}
            extraStyle={{ color: RICH_COLOR_MAP.blue }}
          />
          <ToolbarButton
            label="A"
            title="Green"
            onClick={() => applyFormat("green")}
            extraStyle={{ color: RICH_COLOR_MAP.green }}
          />
          <ToolbarButton
            label="A"
            title="Orange"
            onClick={() => applyFormat("orange")}
            extraStyle={{ color: RICH_COLOR_MAP.orange }}
          />
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

// ─── Marker ↔ HTML conversion ──────────────────────────────────────────
// The persisted format is plain text with simple markers
// (`**bold**`, `==highlight==`, `[red]…[/red]`). Inside the editor we
// expand those to real HTML so the user sees real formatting. On every
// keystroke we walk the DOM back into the marker format and emit it.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markersToHtml(text: string): string {
  if (!text) return "";
  let html = escapeHtml(text);
  // Bold first so it can sit outside / around colour spans naturally.
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /==([^=\n]+)==/g,
    `<mark style="background:${HIGHLIGHT_BG};color:inherit;padding:0 2px">$1</mark>`,
  );
  for (const name of Object.keys(RICH_COLOR_MAP) as Array<keyof typeof RICH_COLOR_MAP>) {
    const re = new RegExp(`\\[${name}\\]([\\s\\S]+?)\\[/${name}\\]`, "g");
    html = html.replace(re, `<span style="color:${RICH_COLOR_MAP[name]}">$1</span>`);
  }
  // Preserve user line breaks.
  html = html.replace(/\n/g, "<br>");
  return html;
}

function htmlToMarkers(root: HTMLElement): string {
  // Walk top-level so we can detect inline-to-block transitions and
  // inject a separator \n (otherwise typing "foo" then Enter then "bar"
  // would serialize as "foobar" because the "bar" lives in a fresh
  // <div> with no inherent boundary to the preceding text node).
  let out = "";
  for (const child of Array.from(root.childNodes)) {
    if (isBlockElement(child) && out.length > 0 && !out.endsWith("\n")) {
      out += "\n";
    }
    out += walkNode(child);
  }
  // Trim a trailing newline that browsers sometimes leave behind from
  // the closing <div> of the last line. Leading newlines are user
  // intent — leave them alone.
  return out.replace(/\n+$/g, "");
}

function isBlockElement(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (node as Element).tagName.toLowerCase();
  return tag === "div" || tag === "p";
}

function walkNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") return "\n";

  // Block elements that contain *only* a <br> are contenteditable's
  // structural filler for an empty line — the div boundary itself is
  // the line break, so don't double-count by recursing into the <br>.
  if (
    (tag === "div" || tag === "p") &&
    el.childNodes.length === 1 &&
    el.firstChild?.nodeType === Node.ELEMENT_NODE &&
    (el.firstChild as Element).tagName.toLowerCase() === "br"
  ) {
    return "\n";
  }

  const inner = walkChildren(el);

  if (tag === "strong" || tag === "b") {
    return inner ? `**${inner}**` : "";
  }
  if (tag === "em" || tag === "i") {
    // We don't have an italic marker — fall through to inner so the
    // user's text isn't lost if they pasted italics from somewhere.
    return inner;
  }
  if (tag === "mark") {
    return inner ? `==${inner}==` : "";
  }
  if (tag === "span" || tag === "font") {
    // Some browsers emit deprecated <font color="…"> from execCommand
    // before we set styleWithCSS; handle both attribute and inline-style.
    const color = el.style?.color || el.getAttribute("color") || "";
    const bg = el.style?.backgroundColor || el.getAttribute("bgcolor") || "";
    const named = colorToName(color);
    if (named) return inner ? `[${named}]${inner}[/${named}]` : "";
    if (bg && isHighlightBg(bg)) return inner ? `==${inner}==` : "";
    return inner;
  }
  if (tag === "div" || tag === "p") {
    return inner + "\n";
  }
  return inner;
}

function walkChildren(node: Node): string {
  let out = "";
  for (const child of Array.from(node.childNodes)) {
    out += walkNode(child);
  }
  return out;
}

function colorToName(c: string): string | null {
  if (!c) return null;
  const norm = c.replace(/\s/g, "").toLowerCase();
  // Match exact hex and rgb() forms of the four supported colours.
  if (norm === "#c1272d" || norm === "rgb(193,39,45)") return "red";
  if (norm === "#1d4ed8" || norm === "rgb(29,78,216)") return "blue";
  if (norm === "#15803d" || norm === "rgb(21,128,61)") return "green";
  if (norm === "#c2410c" || norm === "rgb(194,65,12)") return "orange";
  return null;
}

function isHighlightBg(c: string): boolean {
  const norm = c.replace(/\s/g, "").toLowerCase();
  return (
    norm === HIGHLIGHT_BG.toLowerCase() ||
    norm === "rgb(255,243,163)" ||
    /yellow/.test(norm)
  );
}
