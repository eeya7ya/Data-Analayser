/**
 * Brand variants bundle a printable logo with its matching cover and
 * about-us artwork. Each quotation stores a variant id in its config so
 * switching the logo automatically pulls in the paired cover/about sheets
 * that were designed around it, rather than mixing a logo from one brand
 * with cover art from another.
 *
 * Drop additional artwork into `/public` and add an entry here — the
 * dropdown in the Designer toolbar picks them up automatically.
 */
export interface BrandVariant {
  id: string;
  label: string;
  /** Full description shown under the label in the picker. */
  description?: string;
  /** Logo printed at the top of every quotation sheet. */
  logoUrl: string;
  /** Full-bleed A4 cover page printed first. */
  coverUrl: string;
  /** Full-bleed A4 about-us page printed second. */
  aboutUrl: string;
}

/**
 * The default variant reuses the original Magic Tech assets that shipped
 * with the app — so quotations saved before variants existed keep rendering
 * exactly the same cover, about us and logo without any migration.
 */
export const DEFAULT_BRAND_VARIANT_ID = "magic-tech";

export const BRAND_VARIANTS: BrandVariant[] = [
  {
    id: DEFAULT_BRAND_VARIANT_ID,
    label: "Magic Tech",
    description: "Default Magic Tech branding",
    logoUrl: "/logo.png",
    coverUrl: "/quote-page-1.jpg",
    aboutUrl: "/quote-page-2.jpg",
  },
  {
    // BEAT logo lives at `public/logo_BEAT.jpeg` (uploaded via the GitHub
    // web UI). Cover and about-us sheets fall back to the default Magic
    // Tech artwork until paired BEAT-branded pages are supplied; swap
    // `coverUrl` / `aboutUrl` once those JPGs land in `/public`.
    id: "beat",
    label: "BEAT",
    description: "BEAT-branded logo (reuses default cover / about-us for now)",
    logoUrl: "/logo_BEAT.jpeg",
    coverUrl: "/quote-page-1.jpg",
    aboutUrl: "/quote-page-2.jpg",
  },
];

/**
 * Resolve a variant id to its bundle. When `variants` is supplied (the
 * admin-configured list persisted in app settings) it takes precedence, so
 * the cover/about/logo a quotation prints reflect whatever the admin set up
 * for that brand. Lookups fall back to the built-in list and finally to the
 * first available variant, so a quotation whose stored id was later removed
 * from the admin panel still prints *something* rather than crashing.
 */
export function getBrandVariant(
  id?: string | null,
  variants?: BrandVariant[] | null,
): BrandVariant {
  const list = variants && variants.length > 0 ? variants : BRAND_VARIANTS;
  if (!id) return list[0];
  return (
    list.find((v) => v.id === id) ||
    BRAND_VARIANTS.find((v) => v.id === id) ||
    list[0]
  );
}

/**
 * Coerce an untrusted value (admin form payload or a persisted settings row)
 * into a clean BrandVariant[]. Drops entries missing the fields a printable
 * brand actually needs (id, label, logo, cover, about) and de-duplicates ids
 * so the dropdown never shows two "magic-tech" rows. Returns the built-in
 * defaults when nothing usable is supplied, guaranteeing printing always has
 * at least one brand to fall back on.
 */
export function sanitizeBrandVariants(value: unknown): BrandVariant[] {
  if (!Array.isArray(value)) return [...BRAND_VARIANTS];
  const seen = new Set<string>();
  const out: BrandVariant[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Partial<BrandVariant>;
    const id = String(v.id ?? "").trim();
    const label = String(v.label ?? "").trim();
    const logoUrl = String(v.logoUrl ?? "").trim();
    const coverUrl = String(v.coverUrl ?? "").trim();
    const aboutUrl = String(v.aboutUrl ?? "").trim();
    if (!id || !label || !logoUrl || !coverUrl || !aboutUrl) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label,
      description:
        typeof v.description === "string" ? v.description : undefined,
      logoUrl,
      coverUrl,
      aboutUrl,
    });
  }
  return out.length > 0 ? out : [...BRAND_VARIANTS];
}

/** Turn a free-text label into a stable, url-safe variant id. */
export function brandVariantIdFromLabel(label: string): string {
  return (
    String(label || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "brand"
  );
}
