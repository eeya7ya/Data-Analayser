import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmOrProjectsRead, hasModule } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Distribution form context for one project:
 *   GET ?project_id=X →
 *     { prefill: { company_name, client_name, contact_name, contact_email,
 *                  location }, assignees: [{ id, username, display_name,
 *                  project_roles }] }
 *
 * `prefill` is snapshotted from the project's client folder (freely editable
 * in the form); `assignees` are the technicians / engineers / managers the PM
 * can distribute the project to. Read access: admin, the project owner, or any
 * projects-module user.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmOrProjectsRead(user);

    const projectId = Number(new URL(req.url).searchParams.get("project_id"));
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "invalid project_id" }, { status: 400 });
    }

    const q = sql();
    const rows = (await q`
      select p.owner_id, p.name as project_name,
             cf.name as folder_name, cf.client_email, cf.client_phone,
             cf.client_company, co.name as company_name
      from projects p
      join client_folders cf on cf.id = p.folder_id
      left join companies co on co.id = cf.company_id
      where p.id = ${projectId} and p.deleted_at is null
      limit 1
    `) as Array<{
      owner_id: number | null;
      project_name: string;
      folder_name: string;
      client_email: string | null;
      client_phone: string | null;
      client_company: string | null;
      company_name: string | null;
    }>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
    const r = rows[0];

    const allowed =
      user.role === "admin" ||
      r.owner_id === user.id ||
      (await hasModule(user.id, "projects"));
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const assignees = (await q`
      select u.id, u.username, u.display_name,
        (select string_agg(role, ',') from (
           select distinct r.role
             from user_module_roles r
            where r.user_id = u.id and r.module = 'projects'
              and r.revoked_at is null
         ) roles_sub) as project_roles
      from users u
      where exists (
        select 1 from user_module_roles r2
        where r2.user_id = u.id and r2.module = 'projects'
          and r2.revoked_at is null
      )
      order by coalesce(nullif(u.display_name, ''), u.username)
    `) as Array<Record<string, unknown>>;

    return NextResponse.json({
      prefill: {
        company_name: r.company_name || r.client_company || "",
        client_name: r.folder_name || "",
        contact_name: r.folder_name || "",
        contact_email: r.client_email || "",
        contact_phone: r.client_phone || "",
        location: "",
      },
      assignees,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
