"use client";

import { useRef, useState } from "react";
import type { AppSettings } from "@/lib/settings";
import {
  brandVariantIdFromLabel,
  type BrandVariant,
} from "@/lib/brandVariants";

/**
 * Admin-only editor for brand bundles. Each bundle pairs a printable logo
 * with the two full-bleed "company profile" sheets — page 1 (cover) and
 * page 2 (about us) — that print before every quotation. Picking a logo in
 * the Designer prints its matching company profile, so this panel is where
 * the logo → company-profile wiring is defined.
 *
 * Artwork is stored inline as compressed data URLs in the global settings
 * row (same approach the quotation designer already uses for uploaded
 * pictures), so there's no separate file store to manage.
 */
export default function BrandingAdmin({
  initialSettings,
  readOnly = false,
}: {
  initialSettings: AppSettings;
  readOnly?: boolean;
}) {
  const [variants, setVariants] = useState<BrandVariant[]>(
    initialSettings.brandVariants.map((v) => ({ ...v })),
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function patchVariant(index: number, patch: Partial<BrandVariant>) {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    );
  }

  function addVariant() {
    setVariants((prev) => {
      // Mint a unique id so a brand new bundle never collides with an
      // existing one (which would make the dropdown / resolver drop it).
      const base = brandVariantIdFromLabel(`brand ${prev.length + 1}`);
      let id = base;
      let n = 2;
      const taken = new Set(prev.map((v) => v.id));
      while (taken.has(id)) id = `${base}-${n++}`;
      return [
        ...prev,
        {
          id,
          label: `Brand ${prev.length + 1}`,
          description: "",
          logoUrl: "",
          coverUrl: "",
          aboutUrl: "",
        },
      ];
    });
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function save() {
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      // Mirror the server's validity rule so the admin gets a clear message
      // instead of silently losing a half-filled bundle on save. Page 2
      // (about us) is optional, so it's not required here.
      const incomplete = variants.filter(
        (v) => !v.label.trim() || !v.logoUrl.trim() || !v.coverUrl.trim(),
      );
      if (incomplete.length > 0) {
        throw new Error(
          "Every brand needs a name, a logo and a company profile page 1 " +
            "before it can be saved. Complete or remove the highlighted " +
            "brand(s).",
        );
      }
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandVariants: variants }),
      });
      const data = (await res.json()) as {
        settings?: AppSettings;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "save failed");
      if (data.settings) {
        setVariants(data.settings.brandVariants.map((v) => ({ ...v })));
      }
      setStatus("Saved.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const incompleteIds = new Set(
    variants
      .filter((v) => !v.label.trim() || !v.logoUrl.trim() || !v.coverUrl.trim())
      .map((v) => v.id),
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-magic-ink/70">
        Each <strong>brand</strong> bundles a logo with the company-profile
        sheets printed before every quotation: <strong>page 1</strong> (cover)
        and an optional <strong>page 2</strong> (about us). In the Designer,
        choosing a
        logo from the <em>Brand</em> dropdown prints its matching company
        profile — so picking <em>logo&nbsp;1</em> prints company profile&nbsp;1,
        <em>logo&nbsp;2</em> prints company profile&nbsp;2, and so on. Existing
        quotations keep whichever brand they were saved with.
      </p>

      <div className="space-y-4">
        {variants.map((v, i) => (
          <div
            key={v.id}
            className={`rounded-2xl border bg-white p-4 ${
              incompleteIds.has(v.id)
                ? "border-amber-400"
                : "border-magic-border"
            }`}
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
                  Brand name
                </label>
                <input
                  value={v.label}
                  onChange={(e) => patchVariant(i, { label: e.target.value })}
                  disabled={readOnly}
                  className="w-full max-w-sm rounded-md border border-magic-border px-3 py-1.5 text-sm"
                  placeholder="e.g. Magic Tech"
                />
                <p className="mt-1 text-[10px] text-magic-ink/40">
                  id: <code>{v.id}</code>
                </p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => removeVariant(i)}
                  className="shrink-0 rounded-md border border-magic-border px-3 py-1.5 text-xs text-magic-ink/70 hover:bg-magic-soft"
                  title="Remove this brand"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <ImageSlot
                title="Logo"
                hint="Printed at the top of every sheet (PNG with transparency works best)."
                value={v.logoUrl}
                kind="logo"
                readOnly={readOnly}
                onChange={(next) => patchVariant(i, { logoUrl: next })}
              />
              <ImageSlot
                title="Company profile — page 1 (cover)"
                hint="Full-page A4 cover, printed first."
                value={v.coverUrl}
                kind="page"
                readOnly={readOnly}
                onChange={(next) => patchVariant(i, { coverUrl: next })}
              />
              <ImageSlot
                title="Company profile — page 2 (about us)"
                hint="Optional. Full-page A4 about-us, printed second. Leave empty to print the cover only."
                value={v.aboutUrl ?? ""}
                kind="page"
                readOnly={readOnly}
                onChange={(next) => patchVariant(i, { aboutUrl: next })}
              />
            </div>
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={addVariant}
            className="rounded-md border border-magic-border px-4 py-2 text-sm font-semibold text-magic-ink hover:bg-magic-soft"
          >
            + Add brand
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-magic-red text-white px-4 py-2 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save brands"}
          </button>
          {status && <span className="text-xs text-green-700">{status}</span>}
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      )}
    </div>
  );
}

/** One uploadable image cell (logo or a full A4 company-profile page). */
function ImageSlot({
  title,
  hint,
  value,
  kind,
  readOnly,
  onChange,
}: {
  title: string;
  hint: string;
  value: string;
  kind: "logo" | "page";
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG, JPG, WebP…).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const raw = await readFileAsDataURL(file);
      const compressed = await compressArtwork(raw, kind);
      onChange(compressed);
    } catch (e) {
      setError((e as Error).message || "Couldn't read that image.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl border border-magic-border p-3">
      <p className="text-[11px] font-semibold text-magic-ink mb-1">{title}</p>
      <div
        className={`relative flex items-center justify-center overflow-hidden rounded-md border border-dashed border-magic-border bg-magic-soft ${
          kind === "page" ? "aspect-[210/297]" : "h-24"
        }`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={title}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="px-2 text-center text-[11px] text-magic-ink/40">
            No image yet
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-magic-ink/50">{hint}</p>
      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-magic-border px-2.5 py-1 text-[11px] hover:bg-magic-soft disabled:opacity-60"
          >
            {busy ? "Processing…" : value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="rounded-md border border-magic-border px-2.5 py-1 text-[11px] text-magic-ink/60 hover:bg-magic-soft"
            >
              Remove
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[10px] text-red-600">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Full A4 company-profile pages are printed edge to edge, so they need more
// resolution than the 800px the quotation picture compressor targets — 1240px
// wide is A4 portrait at ~150 DPI, which prints crisply while keeping the
// inline data URL to a few hundred KB. Logos stay small and keep their alpha.
const PAGE_MAX_WIDTH = 1240;
const LOGO_MAX_WIDTH = 600;
const PAGE_JPEG_QUALITY = 0.82;

async function compressArtwork(
  dataUrl: string,
  kind: "logo" | "page",
): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith("data:image/")) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = dataUrl;
    });
    const maxWidth = kind === "page" ? PAGE_MAX_WIDTH : LOGO_MAX_WIDTH;
    const targetWidth =
      img.naturalWidth > maxWidth ? maxWidth : img.naturalWidth;
    const scale = targetWidth / img.naturalWidth;
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // Logos are usually PNG with transparency; keep alpha so they sit cleanly
    // over the sheet. Pages are opaque scans/exports, so JPEG keeps them small.
    const keepAlpha =
      kind === "logo" &&
      (dataUrl.startsWith("data:image/png") ||
        dataUrl.startsWith("data:image/webp"));
    const out = keepAlpha
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", PAGE_JPEG_QUALITY);
    return out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}
