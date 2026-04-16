"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { SessionUser } from "@/lib/auth";
import { loadEditingContext } from "@/lib/quotationDraft";

export default function TopBar({ user }: { user: SessionUser }) {
  const router = useRouter();
  // The Designer can only be entered with an editing context (either an
  // existing quotation id or a pre-selected client folder) — the route
  // itself gates direct access and redirects to /quotation. So here we
  // resume the current edit if there is one, otherwise we send the user
  // back to the Clients & Quotations page where they can pick a client.
  //
  // Two context shapes are valid (see lib/quotationDraft.EditingContext):
  //   • id > 0            → editing a saved quotation, route to ?id=<n>.
  //   • id === 0 + folder → composing a brand-new quotation against a
  //                         client folder, route to ?folder=<n>&new=1 so
  //                         the page gate doesn't bounce the user away.
  function designerHrefFromCtx(
    ctx: ReturnType<typeof loadEditingContext>,
  ): string {
    if (!ctx) return "/quotation";
    if (ctx.id && ctx.id > 0) return `/designer?id=${ctx.id}`;
    if (ctx.folderId) return `/designer?folder=${ctx.folderId}&new=1`;
    return "/quotation";
  }
  const [designerHref, setDesignerHref] = useState(() => {
    if (typeof window === "undefined") return "/quotation";
    return designerHrefFromCtx(loadEditingContext());
  });
  useEffect(() => {
    function onFocus() {
      setDesignerHref(designerHrefFromCtx(loadEditingContext()));
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-40 border-b border-white/40 bg-white/70 backdrop-blur-xl shadow-[0_1px_0_rgba(17,24,39,0.04),0_10px_30px_-20px_rgba(17,24,39,0.25)]">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between px-6 py-3">
        <Link
          href="/quotation"
          className="flex items-center gap-3 group"
          aria-label="Magic Tech · Quotation Designer"
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
            Quotation Designer
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/quotation">Quotations</NavLink>
          <NavLink href={designerHref}>Designer</NavLink>
          <NavLink href="/catalog">Catalogue</NavLink>
          <NavLink href="/ai-designer">AI Designer</NavLink>
          {user.role === "admin" && <NavLink href="/admin">Admin</NavLink>}
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

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="relative rounded-lg px-3 py-1.5 text-sm font-medium text-magic-ink/80 transition-all hover:bg-magic-red/10 hover:text-magic-red"
    >
      {children}
    </Link>
  );
}
