import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser, canReadAll, type SessionUser } from "@/lib/auth";
import { hasModuleRole } from "@/lib/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Checklist templates ("master jobs"). A project manager designs a reusable
 * checklist once here; selecting it while distributing a project seeds that
 * project's checklist automatically (and it stays editable per project).
 *
 *   GET                       → list templates (PM / admin)
 *   POST   { name, items[] }  → create
 *   PATCH  { id, name?, items?} → rename / edit steps
 *   DELETE ?id=X              → permanent delete
 *
 * Only project managers and admins author templates.
 */

async function requireDesigner(user: SessionUser): Promise<void> {
  if (canReadAll(user)) return;
  if (await hasModuleRole(user.id, "projects", "manager")) return;
  throw new Error("FORBIDDEN");
}

/** jsonb comes back parsed on Postgres, a JSON string on D1 — normalise both. */
function parseItems(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = [];
    }
  }
  return Array.isArray(v) ? v.map((x) => String(x ?? "")).filter((s) => s.trim()) : [];
}

function cleanItems(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 200);
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireDesigner(user);
    const q = sql();
    const rows = (await q`
      select id, name, items, created_at
      from checklist_templates
      where deleted_at is null
      order by name asc
    `) as Array<Record<string, unknown>>;
    const templates = rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ""),
      items: parseItems(r.items),
      created_at: r.created_at,
    }));
    return NextResponse.json({ templates });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireDesigner(user);
    const body = (await req.json()) as { name?: string; items?: unknown };
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const items = cleanItems(body.items);
    const q = sql();
    const rows = (await q`
      insert into checklist_templates (name, items, created_by, created_at)
      values (${name.slice(0, 200)}, ${JSON.stringify(items)}::jsonb, ${user.id}, now())
      returning id, name, items, created_at
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    return NextResponse.json({
      template: {
        id: Number(r.id),
        name: String(r.name ?? ""),
        items: parseItems(r.items),
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireDesigner(user);
    const body = (await req.json()) as {
      id?: number;
      name?: string;
      items?: unknown;
    };
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (name) {
        await q`update checklist_templates set name = ${name.slice(0, 200)} where id = ${id}`;
      }
    }
    if (body.items !== undefined) {
      const items = cleanItems(body.items);
      await q`update checklist_templates set items = ${JSON.stringify(items)}::jsonb where id = ${id}`;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireDesigner(user);
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    // Permanent delete (no Trash).
    await q`delete from checklist_templates where id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg === "UNAUTHENTICATED" ? 401 : msg === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
