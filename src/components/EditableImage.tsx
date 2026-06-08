"use client";

/**
 * Reusable click-to-upload image cell. Stores the result as a compressed
 * data URL (≤ 800 px wide, JPEG 70 % unless the source has alpha) so
 * proposals with many uploaded illustrations stay small enough to fit
 * inside the localStorage / API JSON budgets.
 *
 * In print, all editing chrome disappears via the `no-print` class so the
 * placeholder dashed border and Upload/Remove buttons don't leak into
 * the printed PDF.
 */

import { useRef } from "react";
import { compressDataUrl } from "./QuotationPreview";

interface Props {
  /** Current data URL or external URL. Empty string → placeholder. */
  value: string;
  /** Called with the new data URL when the user picks a file. */
  onChange: (next: string) => void;
  /** Short hint shown in the placeholder box. */
  placeholder?: string;
  /** Extra classes on the outer wrapper. */
  className?: string;
  /**
   * Suggested aspect/height for the image box. Defaults to a moderately
   * tall box that works for diagrams and certificates alike. Pass e.g.
   * "12rem" for tall product photos or "6rem" for an inline icon.
   */
  height?: string;
  /** Optional caption (read-only) printed underneath the image. */
  caption?: string;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function EditableImage({
  value,
  onChange,
  placeholder = "Click to upload an image",
  className,
  height = "10rem",
  caption,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPick(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Please choose an image file (PNG, JPG, WebP…).");
      return;
    }
    const dataUrl = await readFileAsDataURL(file);
    const compressed = await compressDataUrl(dataUrl);
    onChange(compressed);
  }

  return (
    <figure className={`editable-image ${className || ""}`}>
      <div
        className="editable-image-frame"
        style={{ minHeight: height }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={caption || placeholder} />
        ) : (
          <div className="editable-image-placeholder no-print">
            <span className="editable-image-plus">＋</span>
            <span>{placeholder}</span>
          </div>
        )}
        <div className="no-print editable-image-actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
            className="editable-image-btn"
          >
            {value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="editable-image-btn editable-image-btn-ghost"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {caption && <figcaption className="editable-image-caption">{caption}</figcaption>}
    </figure>
  );
}
