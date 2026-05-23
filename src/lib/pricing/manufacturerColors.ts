/**
 * Palette used to visually disambiguate manufacturers that share a brand
 * name. Each entry is a tailwind class bundle so the JIT compiler picks
 * up every utility at build time (dynamic class names from a map would
 * otherwise be purged).
 */
export interface ManufacturerColor {
  key: string;
  label: string;
  // Card accent (icon tile background + ring)
  bg: string;
  ring: string;
  // Icon / text foreground on the accent tile
  text: string;
  // Solid swatch (used in the color picker + small badges)
  dot: string;
  // Left border accent on the card
  border: string;
  // Soft background for the tag label pill
  tagBg: string;
  tagText: string;
}

export const MANUFACTURER_COLORS: ManufacturerColor[] = [
  {
    key: "cyan",
    label: "Cyan",
    bg: "bg-cyan-50",
    ring: "ring-cyan-200",
    text: "text-cyan-600",
    dot: "bg-cyan-500",
    border: "border-l-cyan-400",
    tagBg: "bg-cyan-50",
    tagText: "text-cyan-700",
  },
  {
    key: "blue",
    label: "Blue",
    bg: "bg-blue-50",
    ring: "ring-blue-200",
    text: "text-blue-600",
    dot: "bg-blue-500",
    border: "border-l-blue-400",
    tagBg: "bg-blue-50",
    tagText: "text-blue-700",
  },
  {
    key: "indigo",
    label: "Indigo",
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    text: "text-indigo-600",
    dot: "bg-indigo-500",
    border: "border-l-indigo-400",
    tagBg: "bg-indigo-50",
    tagText: "text-indigo-700",
  },
  {
    key: "purple",
    label: "Purple",
    bg: "bg-purple-50",
    ring: "ring-purple-200",
    text: "text-purple-600",
    dot: "bg-purple-500",
    border: "border-l-purple-400",
    tagBg: "bg-purple-50",
    tagText: "text-purple-700",
  },
  {
    key: "pink",
    label: "Pink",
    bg: "bg-pink-50",
    ring: "ring-pink-200",
    text: "text-pink-600",
    dot: "bg-pink-500",
    border: "border-l-pink-400",
    tagBg: "bg-pink-50",
    tagText: "text-pink-700",
  },
  {
    key: "rose",
    label: "Rose",
    bg: "bg-rose-50",
    ring: "ring-rose-200",
    text: "text-rose-600",
    dot: "bg-rose-500",
    border: "border-l-rose-400",
    tagBg: "bg-rose-50",
    tagText: "text-rose-700",
  },
  {
    key: "amber",
    label: "Amber",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    text: "text-amber-600",
    dot: "bg-amber-500",
    border: "border-l-amber-400",
    tagBg: "bg-amber-50",
    tagText: "text-amber-700",
  },
  {
    key: "emerald",
    label: "Emerald",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
    dot: "bg-emerald-500",
    border: "border-l-emerald-400",
    tagBg: "bg-emerald-50",
    tagText: "text-emerald-700",
  },
  {
    key: "slate",
    label: "Slate",
    bg: "bg-slate-50",
    ring: "ring-slate-200",
    text: "text-slate-600",
    dot: "bg-slate-500",
    border: "border-l-slate-400",
    tagBg: "bg-slate-100",
    tagText: "text-slate-700",
  },
];

export const DEFAULT_MANUFACTURER_COLOR = MANUFACTURER_COLORS[0];

export function getManufacturerColor(key?: string | null): ManufacturerColor {
  if (!key) return DEFAULT_MANUFACTURER_COLOR;
  return (
    MANUFACTURER_COLORS.find((c) => c.key === key) ?? DEFAULT_MANUFACTURER_COLOR
  );
}
