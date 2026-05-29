"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  ShieldCheck,
  CalendarDays,
  NotebookPen,
  Megaphone,
  ChevronDown,
  X,
  type LucideIcon,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { canReadAll } from "@/lib/authShared";

interface ModuleRole {
  module: string;
  role: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  show: boolean;
}

/**
 * Left-hand-side navigation drawer — the "toggle rectangle". Closed by
 * default and opened from the TopBar toggle. Overlays content (no
 * reflow) so every page keeps its existing layout. Admin lives here
 * (bottom section) rather than in the top bar, per the V1.3a chrome
 * spec. The cross-client quotation surfaces (All quotations, Purchase
 * orders) live in a collapsed "Quotation tools" group so they stay
 * reachable without cluttering the primary nav. The Catalogue now lives
 * inside the CRM → Storage workspace (a Storage-people surface), so it
 * is no longer listed here. The Designer / AI Designer are reached
 * in-context from the CRM flow, so they're not nav entries.
 */
export default function SideNav({
  open,
  onClose,
  user,
  moduleRoles,
}: {
  open: boolean;
  onClose: () => void;
  user: SessionUser;
  moduleRoles: ModuleRole[] | null;
}) {
  const pathname = usePathname();
  const [toolsOpen, setToolsOpen] = useState(false);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isAdmin = canReadAll(user);
  const has = (m: string) =>
    isAdmin ||
    moduleRoles === null ||
    moduleRoles.length === 0 ||
    moduleRoles.some((r) => r.module === m);

  // CRM is the single hub for the work modules (Sales / Presales /
  // Storage / Projects / Pricing live as tabs inside it), so the drawer
  // intentionally does NOT repeat them — only the top-level surfaces.
  // Personal tools — available to every signed-in user, each with its own
  // private data. Kept alongside the primary surfaces (not behind a
  // separate group) so they're one tap away.
  const primary: NavItem[] = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, show: true },
    { href: "/crm", label: "CRM", icon: Building2, show: has("crm") || has("projects") },
    { href: "/calendar", label: "Calendar", icon: CalendarDays, show: true },
    { href: "/notes", label: "My Notes", icon: NotebookPen, show: true },
    { href: "/updates", label: "Updates", icon: Megaphone, show: true },
  ].filter((i) => i.show);

  // Cross-client quotation surfaces. Reached contextually from the CRM flow
  // too; this group just keeps the global lists one tap away for CRM users.
  const quotationTools = [
    { href: "/quotation", label: "All quotations" },
    { href: "/purchase-orders", label: "Purchase orders" },
  ];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-50 bg-magic-ink/40 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Navigation"
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-white/50 bg-white/85 backdrop-blur-2xl shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-sm font-bold tracking-tight text-magic-ink">
            Navigate
          </span>
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-magic-ink/60 hover:bg-magic-soft hover:text-magic-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          <ul className="space-y-1">
            {primary.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      active
                        ? "bg-gradient-to-r from-magic-red/12 to-magic-accent/10 text-magic-red shadow-sm"
                        : "text-magic-ink/75 hover:bg-magic-soft hover:text-magic-ink"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Cross-client quotation tools — collapsed, out of the way. */}
          {has("crm") && (
            <div className="mt-3">
              <button
                onClick={() => setToolsOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-magic-ink/40 hover:text-magic-ink/70 transition-colors"
              >
                Quotation tools
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${toolsOpen ? "rotate-180" : ""}`}
                />
              </button>
              {toolsOpen && (
                <ul className="space-y-0.5 pb-1">
                  {quotationTools.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className="block rounded-lg px-3 py-2 text-sm text-magic-ink/65 hover:bg-magic-soft hover:text-magic-red transition-colors"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </nav>

        {/* Admin — the LHS toggle entry, gated to admins. */}
        {isAdmin && (
          <div className="border-t border-magic-border/60 p-3">
            <Link
              href="/admin"
              onClick={onClose}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                isActive("/admin")
                  ? "bg-magic-ink text-white shadow-sm"
                  : "bg-magic-ink/5 text-magic-ink hover:bg-magic-ink hover:text-white"
              }`}
            >
              <ShieldCheck className="h-[18px] w-[18px] shrink-0" />
              Admin console
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
