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
    id: "magic-tech-alt",
    label: "Magic Tech — Alternate",
    description: "Alternate Magic Tech look",
    logoUrl: "/logo-alt.png",
    coverUrl: "/quote-page-1-alt.jpg",
    aboutUrl: "/quote-page-2-alt.jpg",
  },
  {
    id: "partner-brand",
    label: "Partner Brand",
    description: "Co-branded partner variant",
    logoUrl: "/logo-partner.png",
    coverUrl: "/quote-page-1-partner.jpg",
    aboutUrl: "/quote-page-2-partner.jpg",
  },
];

export function getBrandVariant(id?: string | null): BrandVariant {
  if (!id) return BRAND_VARIANTS[0];
  return BRAND_VARIANTS.find((v) => v.id === id) || BRAND_VARIANTS[0];
}
