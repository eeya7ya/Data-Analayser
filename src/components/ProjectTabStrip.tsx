"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Tab strip for the project drill-down. Lives in a Client Component
 * because Next server layouts can't reliably know which child page
 * rendered them — `usePathname()` is the canonical way to highlight
 * the active tab from the actual URL.
 */
export default function ProjectTabStrip({ base }: { base: string }) {
  const path = usePathname();
  const tabs: Array<{ href: string; label: string; match: string }> = [
    { href: `${base}/quotations`, label: "Quotations", match: "/quotations" },
    { href: `${base}/pos`, label: "Purchase Orders", match: "/pos" },
    { href: `${base}/boqs`, label: "BOQs / Files", match: "/boqs" },
  ];

  return (
    <div className="border-b border-magic-border">
      <nav className="flex items-center gap-1">
        {tabs.map((t) => {
          const active =
            path === t.href ||
            path?.startsWith(`${t.href}/`) ||
            // /[projectId] root → default to quotations highlight
            (t.match === "/quotations" && path === base);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                active
                  ? "border-magic-red text-magic-red"
                  : "border-transparent text-magic-ink/60 hover:text-magic-ink"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
