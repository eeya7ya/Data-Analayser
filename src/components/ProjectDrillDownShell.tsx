import Link from "next/link";
import TopBar from "@/components/TopBar";
import RequestStockButton from "@/components/RequestStockButton";
import ProjectTabStrip from "@/components/ProjectTabStrip";
import type { SessionUser } from "@/lib/auth";

/**
 * Shared shell for every project-level drill-down page. Each route
 * file under the CRM hierarchy passes its own breadcrumb (the chain
 * back through CRM → company / individual → client) plus the project
 * record. The shell renders TopBar, breadcrumb, project header,
 * Request-stock button, and the tab strip; the page content slots
 * in as `children`.
 *
 * The component intentionally accepts a pre-resolved project record
 * — it doesn't do its own DB call — so each route can use whatever
 * access check (lib/projectAccess.ts) is appropriate for that path.
 */

export interface Crumb {
  href?: string;
  label: string;
}

export interface DrillDownProject {
  id: number;
  name: string;
  description: string | null;
  status: string;
}

export default function ProjectDrillDownShell({
  user,
  project,
  base,
  breadcrumb,
  children,
}: {
  user: SessionUser;
  project: DrillDownProject;
  base: string;
  breadcrumb: Crumb[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-6xl mx-auto px-6 py-6 lg:px-10 space-y-5">
        <div>
          <div className="text-xs text-magic-ink/50">
            {breadcrumb.map((c, i) => (
              <span key={`${i}:${c.label}`}>
                {i > 0 && <span> → </span>}
                {c.href ? (
                  <Link href={c.href} className="hover:text-magic-red">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
              </span>
            ))}
          </div>
          <div className="flex items-start justify-between gap-3 mt-1">
            <div>
              <h1 className="text-2xl font-bold text-magic-ink">
                {project.name}
              </h1>
              <div className="text-xs text-magic-ink/60 mt-0.5">
                status: {project.status}
              </div>
              {project.description && (
                <p className="text-sm text-magic-ink/80 mt-2 whitespace-pre-line">
                  {project.description}
                </p>
              )}
            </div>
            <RequestStockButton projectId={project.id} />
          </div>
        </div>

        <ProjectTabStrip base={base} />

        {children}
      </main>
    </div>
  );
}

/**
 * Friendly "no access" page used by the various drill-down layouts
 * when loadAccessibleProject returns null. Avoids a 403 modal so the
 * user can keep navigating.
 */
export function NoProjectAccess({
  user,
  fallbackHref,
  fallbackLabel,
}: {
  user: SessionUser;
  fallbackHref: string;
  fallbackLabel: string;
}) {
  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-3xl mx-auto p-6 text-center">
        <h1 className="text-xl font-bold text-magic-ink mb-2">
          You don&apos;t have access to this project
        </h1>
        <p className="text-sm text-magic-ink/60">
          Ask the owner to assign you, or an admin to grant projects-module
          access. The project and every file under it stay intact regardless
          of access changes.
        </p>
        <Link
          href={fallbackHref}
          className="inline-block mt-4 rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft transition-colors"
        >
          ← {fallbackLabel}
        </Link>
      </main>
    </div>
  );
}
