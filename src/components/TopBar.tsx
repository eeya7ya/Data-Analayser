"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { SessionUser } from "@/lib/auth";
import NotificationsBell from "@/components/NotificationsBell";

interface ModuleRole {
  module: string;
  role: string;
}

/**
 * V2.0 nav surface. Four top-level entries that mirror the four
 * modules; the CRM tab is a drill-down (kind → client → project →
 * quotations / POs / BOQs), not a peer-list. Legacy URLs like
 * /quotation, /folder/[id], /designer, /catalog, /ai-designer,
 * /purchase-orders, /projects, /inbox/approvals, /storage remain
 * fully functional — they're reachable via the "Legacy" link below
 * (or directly by URL) so old bookmarks and any data not yet
 * re-routed through the new hierarchy stays accessible.
 */
export default function TopBar({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [moduleRoles, setModuleRoles] = useState<ModuleRole[] | null>(null);
  const [approvalCount, setApprovalCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { module_roles?: ModuleRole[] }) => {
        if (!cancelled && Array.isArray(data.module_roles)) {
          setModuleRoles(data.module_roles);
        }
      })
      .catch(() => {
        if (!cancelled) setModuleRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/inbox/approvals/count", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { total?: number }) => {
        if (!cancelled && typeof data.total === "number") {
          setApprovalCount(data.total);
        }
      })
      .catch(() => {
        // soft-fail
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = user.role === "admin";
  const hasStorageAccess =
    isAdmin || (moduleRoles?.some((r) => r.module === "storage") ?? false);
  const hasCrmAccess =
    isAdmin ||
    moduleRoles === null ||
    moduleRoles.some((r) => r.module === "crm" || r.module === "projects") ||
    // Legacy bypass: a user with no module roles still gets the CRM tab
    // (they had access pre-V2; requireModuleAllowLegacy lets the API
    // through and stamps an audit row).
    moduleRoles.length === 0;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Mobile drawer toggle. On screens <md the full nav collapses behind
  // a hamburger, so the bar fits ~360 px wide phones without wrapping.
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-white/70 backdrop-blur-xl shadow-[0_1px_0_rgba(17,24,39,0.04),0_10px_30px_-20px_rgba(17,24,39,0.25)]">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 group min-w-0"
          aria-label="Magic Tech · Dashboard"
        >
          <Image
            src="/logo.png"
            alt="Magic Tech"
            width={680}
            height={200}
            priority
            className="h-8 sm:h-9 w-auto object-contain transition-transform group-hover:scale-[1.02]"
          />
          <span className="hidden sm:inline-block rounded-full bg-gradient-to-r from-magic-red/10 to-magic-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-magic-red/80">
            Dashboard
          </span>
        </Link>

        {/* Desktop nav — md and above */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          <NavLink href="/">Dashboard</NavLink>
          {hasCrmAccess && <NavLink href="/crm">CRM</NavLink>}
          {hasStorageAccess && <NavLink href="/storage">Storage</NavLink>}
          {isAdmin && <NavLink href="/admin">Admin</NavLink>}

          {/* Legacy URLs — every page from the pre-V2 nav is still here. */}
          <LegacyMenu approvalCount={approvalCount} />

          {/* Consolidated alarm tray. Pulls pending approvals + unattached
              folders + unclassified-folder warnings into one bell so the
              CRM pages don't have to render big inline banners. */}
          <NotificationsBell />

          <span className="ml-3 hidden lg:inline-flex items-center gap-1.5 rounded-full border border-magic-border/60 bg-white/60 px-3 py-1 text-[11px] font-medium text-magic-ink/70">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {user.display_name || user.username}
            <span className="text-magic-ink/40">· {user.role}</span>
          </span>
          <button
            onClick={logout}
            className="ml-2 rounded-xl bg-gradient-to-r from-magic-ink to-magic-ink/80 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:shadow-md hover:from-magic-red hover:to-magic-red/80 transition-all"
          >
            Sign out
          </button>
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="md:hidden relative inline-flex items-center justify-center rounded-lg border border-magic-border/60 bg-white/60 p-2 text-magic-ink/80 hover:bg-magic-soft transition-colors"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            {mobileOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
          {!mobileOpen && approvalCount > 0 && (
            <span
              aria-label={`${approvalCount} pending approvals`}
              className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full bg-magic-red text-white text-[9px] font-bold px-1"
            >
              {approvalCount > 99 ? "99+" : approvalCount}
            </span>
          )}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-magic-border/60 bg-white/95 backdrop-blur-xl">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-col gap-1">
            <MobileNavLink href="/" onClick={closeMobile}>
              Dashboard
            </MobileNavLink>
            {hasCrmAccess && (
              <MobileNavLink href="/crm" onClick={closeMobile}>
                CRM
              </MobileNavLink>
            )}
            {hasStorageAccess && (
              <MobileNavLink href="/storage" onClick={closeMobile}>
                Storage
              </MobileNavLink>
            )}
            {isAdmin && (
              <MobileNavLink href="/admin" onClick={closeMobile}>
                Admin
              </MobileNavLink>
            )}
            <div className="my-1 h-px bg-magic-border/60" />
            <p className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-magic-ink/40">
              Legacy
            </p>
            <MobileNavLink href="/quotation" onClick={closeMobile}>
              All quotations (legacy list)
            </MobileNavLink>
            <MobileNavLink href="/designer" onClick={closeMobile}>
              Designer
            </MobileNavLink>
            <MobileNavLink href="/ai-designer" onClick={closeMobile}>
              AI Designer
            </MobileNavLink>
            <MobileNavLink href="/catalog" onClick={closeMobile}>
              Catalogue
            </MobileNavLink>
            <MobileNavLink href="/purchase-orders" onClick={closeMobile}>
              Purchase orders (list)
            </MobileNavLink>
            <MobileNavLink href="/projects" onClick={closeMobile}>
              Projects (flat list)
            </MobileNavLink>
            <MobileNavLink href="/inbox/approvals" onClick={closeMobile}>
              Approvals inbox
              {approvalCount > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-magic-red/15 text-magic-red px-1.5 py-0.5 text-[10px] font-semibold">
                  {approvalCount}
                </span>
              )}
            </MobileNavLink>
            <div className="my-2 h-px bg-magic-border/60" />
            <div className="flex items-center justify-between gap-2 px-3 py-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-magic-ink/70">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {user.display_name || user.username}
                <span className="text-magic-ink/40">· {user.role}</span>
              </span>
              <button
                onClick={() => {
                  closeMobile();
                  void logout();
                }}
                className="rounded-xl bg-gradient-to-r from-magic-ink to-magic-ink/80 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-magic-red hover:to-magic-red/80 transition-all"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function MobileNavLink({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block rounded-lg px-3 py-2 text-sm font-medium text-magic-ink/85 hover:bg-magic-soft hover:text-magic-red transition-colors"
    >
      {children}
    </Link>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="relative rounded-lg px-3 py-1.5 text-sm font-medium text-magic-ink/80 transition-all hover:bg-magic-red/10 hover:text-magic-red"
    >
      {children}
    </Link>
  );
}

/**
 * "Legacy" dropdown. Holds every pre-V2 page so existing bookmarks
 * keep working and orphan data (quotations / POs / files that haven't
 * been re-routed through the new /crm hierarchy yet) stays reachable
 * for re-assignment. Nothing here is deleted.
 */
function LegacyMenu({ approvalCount }: { approvalCount: number }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The menu opens on click, so close on click-outside or Esc — not on
  // mouseleave. The 4px mt-1 gap between the button and the panel
  // means a mouseleave handler dismissed the menu the moment the
  // cursor moved between them, which is what the user was seeing.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg px-3 py-1.5 text-sm font-medium text-magic-ink/60 hover:bg-magic-soft hover:text-magic-ink transition-all"
      >
        Legacy ▾
        {approvalCount > 0 && (
          <span
            aria-label={`${approvalCount} pending approvals`}
            className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-magic-red text-white text-[10px] font-bold px-1.5 align-middle"
          >
            {approvalCount > 99 ? "99+" : approvalCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-xl border border-magic-border bg-white shadow-lg py-1.5 z-50">
          <LegacyLink href="/quotation">All quotations (legacy list)</LegacyLink>
          <LegacyLink href="/designer">Designer</LegacyLink>
          <LegacyLink href="/ai-designer">AI Designer</LegacyLink>
          <LegacyLink href="/catalog">Catalogue</LegacyLink>
          <LegacyLink href="/purchase-orders">Purchase orders (list)</LegacyLink>
          <LegacyLink href="/projects">Projects (flat list)</LegacyLink>
          <LegacyLink href="/inbox/approvals">
            Approvals inbox
            {approvalCount > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-magic-red/15 text-magic-red px-1.5 py-0.5 text-[10px] font-semibold">
                {approvalCount}
              </span>
            )}
          </LegacyLink>
          <div className="h-px bg-magic-border/60 my-1" />
          <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-magic-ink/40">
            Pre-V2 URLs — kept so existing data stays reachable
          </p>
        </div>
      )}
    </div>
  );
}

function LegacyLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block px-3 py-1.5 text-sm text-magic-ink/80 hover:bg-magic-soft hover:text-magic-red transition-colors"
    >
      {children}
    </Link>
  );
}
