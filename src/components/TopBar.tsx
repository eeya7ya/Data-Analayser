"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Menu, LogOut } from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import NotificationsBell from "@/components/NotificationsBell";
import SideNav from "@/components/SideNav";
import AppFooter from "@/components/AppFooter";

interface ModuleRole {
  module: string;
  role: string;
}

/**
 * V1.3a app chrome. The top bar is now intentionally minimal — brand,
 * the LHS-drawer toggle, the notification bell, and the user/sign-out
 * controls. All module navigation (CRM, Storage, Pricing, Projects) and
 * Admin moved into the collapsible SideNav drawer so the bar stays
 * clean and fills the full width. The fixed AppFooter (version bar) and
 * the SideNav are rendered here so every page that mounts <TopBar/>
 * gets the full chrome with no per-page wiring.
 */
export default function TopBar({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [moduleRoles, setModuleRoles] = useState<ModuleRole[] | null>(null);
  const [navOpen, setNavOpen] = useState(false);

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/40 bg-white/70 backdrop-blur-xl shadow-[0_1px_0_rgba(17,24,39,0.04),0_10px_30px_-20px_rgba(17,24,39,0.25)]">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-magic-border/70 bg-white/70 px-3 text-magic-ink/80 shadow-sm hover:border-magic-red/40 hover:text-magic-red transition-colors"
            >
              <Menu className="h-4 w-4" />
              <span className="hidden text-xs font-semibold sm:inline">Menu</span>
            </button>
            <Link
              href="/"
              className="group flex min-w-0 items-center gap-3"
              aria-label="Magic Tech · Dashboard"
            >
              <Image
                src="/logo.png"
                alt="Magic Tech"
                width={680}
                height={200}
                priority
                className="h-8 w-auto object-contain transition-transform group-hover:scale-[1.02] sm:h-9"
              />
              <span className="hidden rounded-full bg-gradient-to-r from-magic-red/10 to-magic-accent/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-magic-red/80 md:inline-block">
                Dashboard
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <NotificationsBell />
            <span className="ml-1 hidden items-center gap-1.5 rounded-full border border-magic-border/60 bg-white/60 px-3 py-1 text-[11px] font-medium text-magic-ink/70 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {user.display_name || user.username}
              <span className="text-magic-ink/40">· {user.role}</span>
            </span>
            <button
              onClick={logout}
              aria-label="Sign out"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-magic-ink to-magic-ink/80 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:from-magic-red hover:to-magic-red/80 hover:shadow-md"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <SideNav
        open={navOpen}
        onClose={() => setNavOpen(false)}
        user={user}
        moduleRoles={moduleRoles}
      />
      <AppFooter />
    </>
  );
}
