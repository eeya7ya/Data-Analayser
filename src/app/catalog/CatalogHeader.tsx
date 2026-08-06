"use client";

import { Boxes, Factory, Layers } from "@/lib/icons";

/**
 * Page header for the Catalogue Modifier.
 *
 * A client component purely so it can use the icon set — the icons carry a
 * React context (IconProvider sets the shared weight), which a server
 * component can't import. The counts are computed on the server and passed
 * down, so this renders no data of its own.
 */
export default function CatalogHeader({
  productCount,
  vendorCount,
  systemCount,
}: {
  productCount: number;
  vendorCount: number;
  systemCount: number;
}) {
  return (
    <header className="mb-5 overflow-hidden rounded-2xl border border-magic-border bg-gradient-to-br from-magic-red/8 via-white to-white p-6 shadow-mt-soft">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-magic-red/10 text-magic-red">
            <Boxes className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
              Catalogue Modifier
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-magic-ink/60">
              Upload or export the catalogue in bulk, browse every product with
              full specs, and edit prices, models and pictures. Quotation
              builders pick from this same catalogue in the designer.
            </p>
          </div>
        </div>
        <dl className="flex shrink-0 items-stretch gap-2.5">
          <Stat
            icon={<Boxes className="h-3.5 w-3.5" />}
            label="Products"
            value={productCount}
          />
          <Stat
            icon={<Factory className="h-3.5 w-3.5" />}
            label="Vendors"
            value={vendorCount}
          />
          <Stat
            icon={<Layers className="h-3.5 w-3.5" />}
            label="Systems"
            value={systemCount}
          />
        </dl>
      </div>
    </header>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="min-w-24 rounded-xl border border-magic-border bg-white/80 px-3.5 py-2.5 text-center shadow-sm">
      <dt className="flex items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-magic-ink/45">
        <span className="text-magic-red/70">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 text-xl font-bold tabular-nums leading-none text-magic-ink">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
