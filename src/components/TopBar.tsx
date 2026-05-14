"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { SessionUser } from "@/lib/auth";

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

  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-white/70 backdrop-blur-xl shadow-[0_1px_0_rgba(17,24,39,0.04),0_10px_30px_-20px_rgba(17,24,39,0.25)]">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-3 group"
          aria-label="Magic Tech · Dashboard"
        >
          <Image
            src="/logo.png"
            alt="Magic Tech"
            width={680}
            height={200}
            priority
            className="h-9 w-auto object-contain transition-transform group-hover:scale-[1.02]"
          />
          <span className="hidden sm:inline-block rounded-full bg-gradient-to-r from-magic-red/10 to-magic-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-magic-red/80">
            Dashboard
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/">Dashboard</NavLink>
          {hasCrmAccess && <NavLink href="/crm">CRM</NavLink>}
          {hasStorageAccess && <NavLink href="/storage">Storage</NavLink>}
          {isAdmin && <NavLink href="/admin">Admin</NavLink>}

          {/* Legacy URLs — every page from the pre-V2 nav is still here. */}
          <LegacyMenu approvalCount={approvalCount} />

          <span className="ml-3 hidden md:inline-flex items-center gap-1.5 rounded-full border border-magic-border/60 bg-white/60 px-3 py-1 text-[11px] font-medium text-magic-ink/70">
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
      </div>
    </header>
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
  return (
    <div
      className="relative"
      onMouseLeave={() => setOpen(false)}
    >
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
