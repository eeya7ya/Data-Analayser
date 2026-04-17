"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit {
  href: string;
  label: string;
  sub?: string;
  group: string;
}

interface SearchResponse {
  contacts: { id: number; first_name: string | null; last_name: string | null; email: string | null }[];
  companies: { id: number; name: string }[];
  deals: { id: number; title: string; amount: number }[];
  quotations: { id: number; ref: string | null; project_name: string | null; client_name: string | null }[];
}

const STATIC_NAV: Hit[] = [
  { href: "/crm/dashboard", label: "Dashboard", group: "Navigate" },
  { href: "/crm/contacts", label: "Contacts", group: "Navigate" },
  { href: "/crm/companies", label: "Companies", group: "Navigate" },
  { href: "/crm/deals", label: "Deals", group: "Navigate" },
  { href: "/crm/tasks", label: "Tasks", group: "Navigate" },
  { href: "/crm/workflows", label: "Workflows", group: "Navigate" },
  { href: "/quotation", label: "Quotations", group: "Navigate" },
  { href: "/catalog", label: "Catalogue", group: "Navigate" },
];

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((s) => !s);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else {
      setQ("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (q.trim().length < 2) {
      setHits(filterStatic(q, STATIC_NAV));
      setActive(0);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crm/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = (await res.json()) as SearchResponse;
        if (cancelled) return;
        const out: Hit[] = [];
        for (const c of data.contacts ?? []) {
          const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || c.email || "(unnamed)";
          out.push({ href: `/crm/contacts/${c.id}`, label: name, sub: c.email ?? undefined, group: "Contacts" });
        }
        for (const co of data.companies ?? []) {
          out.push({ href: `/crm/companies/${co.id}`, label: co.name, group: "Companies" });
        }
        for (const d of data.deals ?? []) {
          out.push({
            href: `/crm/deals#${d.id}`,
            label: d.title,
            sub: `$${Number(d.amount).toLocaleString()}`,
            group: "Deals",
          });
        }
        for (const Q of data.quotations ?? []) {
          out.push({
            href: `/designer?id=${Q.id}`,
            label: Q.ref ?? `#${Q.id}`,
            sub: Q.project_name ?? Q.client_name ?? undefined,
            group: "Quotations",
          });
        }
        setHits([...filterStatic(q, STATIC_NAV), ...out]);
        setActive(0);
      } catch {
        /* swallow */
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  function go(h: Hit) {
    setOpen(false);
    router.push(h.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      const h = hits[active];
      if (h) go(h);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 backdrop-blur-sm pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[640px] max-w-[92vw] rounded-2xl border border-magic-border bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search contacts, companies, deals, quotations…"
          className="w-full px-4 py-3 text-sm border-b border-magic-border outline-none"
        />
        <div className="max-h-[55vh] overflow-y-auto">
          {hits.length === 0 ? (
            <div className="p-6 text-sm text-magic-ink/60 text-center">
              {q.length < 2 ? "Type at least 2 characters." : "No matches."}
            </div>
          ) : (
            renderGrouped(hits, active, go)
          )}
        </div>
        <div className="px-4 py-2 border-t border-magic-border bg-magic-soft/40 text-[10px] text-magic-ink/50 flex justify-between">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}

function filterStatic(q: string, items: Hit[]): Hit[] {
  if (!q.trim()) return items;
  const lc = q.toLowerCase();
  return items.filter((i) => i.label.toLowerCase().includes(lc));
}

function renderGrouped(hits: Hit[], active: number, go: (h: Hit) => void) {
  const groups: { name: string; items: { hit: Hit; idx: number }[] }[] = [];
  hits.forEach((hit, idx) => {
    const last = groups[groups.length - 1];
    if (last && last.name === hit.group) last.items.push({ hit, idx });
    else groups.push({ name: hit.group, items: [{ hit, idx }] });
  });
  return groups.map((g) => (
    <div key={g.name}>
      <div className="px-4 py-1.5 text-[10px] font-semibold uppercase text-magic-ink/40 bg-magic-soft/30">
        {g.name}
      </div>
      {g.items.map(({ hit, idx }) => (
        <button
          key={hit.href + idx}
          onClick={() => go(hit)}
          onMouseEnter={() => {
            /* no-op; keyboard owns active */
          }}
          className={
            "block w-full text-left px-4 py-2 text-sm border-b border-magic-border/40 last:border-b-0 " +
            (idx === active ? "bg-magic-red/10 text-magic-red" : "text-magic-ink/80 hover:bg-magic-soft")
          }
        >
          <div className="font-medium">{hit.label}</div>
          {hit.sub && <div className="text-xs text-magic-ink/50">{hit.sub}</div>}
        </button>
      ))}
    </div>
  ));
}
