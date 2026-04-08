import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";
import TopBar from "@/components/TopBar";
import QuotationViewer from "@/components/QuotationViewer";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface SearchParams {
  id?: string;
}

export default async function QuotationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  await ensureSchema();
  const q = sql();

  if (sp.id) {
    const rows = (await q`
      select * from quotations where id = ${Number(sp.id)} limit 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) {
      return (
        <div className="min-h-screen bg-magic-soft/40">
          <TopBar user={user} />
          <main className="max-w-5xl mx-auto p-6">
            <p className="text-sm text-magic-ink/70">Quotation not found.</p>
          </main>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-magic-soft/40">
        <div className="no-print">
          <TopBar user={user} />
        </div>
        <main className="max-w-5xl mx-auto p-6">
          <QuotationViewer row={row} />
        </main>
      </div>
    );
  }

  const rows = (await q`
    select id, ref, project_name, client_name, site_name, created_at
    from quotations
    where owner_id = ${user.id} or ${user.role} = 'admin'
    order by id desc
    limit 100
  `) as Array<{
    id: number;
    ref: string;
    project_name: string;
    client_name: string | null;
    site_name: string;
    created_at: string;
  }>;

  return (
    <div className="min-h-screen bg-magic-soft/40">
      <TopBar user={user} />
      <main className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-magic-ink mb-4">
          Saved Quotations
        </h1>
        <div className="rounded-2xl border border-magic-border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-magic-header text-magic-red text-xs uppercase">
              <tr>
                <th className="p-3 text-left">Ref</th>
                <th className="p-3 text-left">Project</th>
                <th className="p-3 text-left">Client</th>
                <th className="p-3 text-left">Site</th>
                <th className="p-3 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-magic-ink/50">
                    No quotations yet. Go to{" "}
                    <Link href="/designer" className="text-magic-red underline">
                      the Designer
                    </Link>{" "}
                    to create one.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-magic-border">
                  <td className="p-3 font-mono">
                    <Link
                      href={`/quotation?id=${r.id}`}
                      className="text-magic-red hover:underline"
                    >
                      {r.ref}
                    </Link>
                  </td>
                  <td className="p-3">{r.project_name}</td>
                  <td className="p-3">{r.client_name || "—"}</td>
                  <td className="p-3">{r.site_name}</td>
                  <td className="p-3 text-xs text-magic-ink/60">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
