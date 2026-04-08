"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SessionUser } from "@/lib/auth";

export default function TopBar({ user }: { user: SessionUser }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <header className="border-b border-magic-border bg-white">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
        <Link href="/designer" className="flex items-center gap-2">
          <span className="text-xl font-black text-magic-red">Magic</span>
          <span className="text-xl font-black text-magic-ink">Tech</span>
          <span className="ml-2 text-xs text-magic-ink/50">
            Quotation Designer
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/designer" className="text-magic-ink hover:text-magic-red">
            Designer
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
            {user.username} · {user.role}
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
