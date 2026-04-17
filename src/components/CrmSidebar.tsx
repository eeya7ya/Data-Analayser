"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/crm/dashboard", label: "Dashboard" },
  { href: "/crm/contacts", label: "Contacts" },
  { href: "/crm/companies", label: "Companies" },
  { href: "/crm/deals", label: "Deals" },
  { href: "/crm/tasks", label: "Tasks" },
  { href: "/crm/workflows", label: "Workflows" },
];

const adminItems = [{ href: "/crm/teams", label: "Teams" }];

export default function CrmSidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const all = [...items, ...(isAdmin ? adminItems : [])];
  return (
    <aside className="w-56 shrink-0 border-r border-magic-border/60 bg-white/40 px-3 py-4">
      <ul className="space-y-1">
        {all.map((it) => {
          const active =
            pathname === it.href ||
            (it.href !== "/crm" && pathname?.startsWith(it.href + "/"));
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className={
                  "block rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "bg-magic-red/10 text-magic-red"
                    : "text-magic-ink/80 hover:bg-magic-red/5 hover:text-magic-red")
                }
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
