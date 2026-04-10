"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { loadEditingContext } from "@/lib/quotationDraft";

export default function TopBar({ user }: { user: SessionUser }) {
  const router = useRouter();
  // Keep the Designer nav link in sync with the editing context so clicking
  // it never accidentally starts a new quotation while the user is editing.
  const [designerHref, setDesignerHref] = useState("/designer");
  useEffect(() => {
    const ctx = loadEditingContext();
    setDesignerHref(ctx ? `/designer?id=${ctx.id}` : "/designer");
    // Refresh the link whenever the tab regains focus (e.g. after catalog
    // interactions that may have changed the editing context).
    function onFocus() {
      const c = loadEditingContext();
      setDesignerHref(c ? `/designer?id=${c.id}` : "/designer");
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
    <header className="border-b border-magic-border bg-white">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
        <Link href={designerHref} className="flex items-center gap-2">
          <span className="text-xl font-black text-magic-red">Magic</span>
          <span className="text-xl font-black text-magic-ink">Tech</span>
          <span className="ml-2 text-xs text-magic-ink/50">
            Quotation Designer
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href={designerHref} className="text-magic-ink hover:text-magic-red">
            Designer
          </Link>
          <Link href="/ai-designer" className="text-magic-ink hover:text-magic-red">
            AI Designer
          </Link>
          <Link href="/catalog" className="text-magic-ink hover:text-magic-red">
            Catalog
          </Link>
          <Link
            href="/quotation"
            className="text-magic-ink hover:text-magic-red"
          >
            Quotations
          </Link>
          {user.role === "admin" && (
            <Link
              href="/admin"
              className="text-magic-ink hover:text-magic-red"
            >
              Admin
            </Link>
          )}
          <span className="text-xs text-magic-ink/50">
            {user.display_name || user.username} · {user.role}
          </span>
          <button
            onClick={logout}
            className="rounded-md border border-magic-border px-3 py-1 text-xs hover:bg-magic-soft"
          >
            Sign out
          </button>
        </nav>
      </div>
    </header>
  );
}
