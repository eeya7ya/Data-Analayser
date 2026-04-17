import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface Pipeline {
  id: number;
  owner_id: number | null;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface Stage {
  id: number;
  pipeline_id: number;
  name: string;
  position: number;
  win_prob: number;
  is_won: boolean;
  is_lost: boolean;
}

const DEFAULT_STAGES: Array<Omit<Stage, "id" | "pipeline_id">> = [
  { name: "New",         position: 1, win_prob: 10, is_won: false, is_lost: false },
  { name: "Qualified",   position: 2, win_prob: 25, is_won: false, is_lost: false },
  { name: "Proposal",    position: 3, win_prob: 50, is_won: false, is_lost: false },
  { name: "Negotiation", position: 4, win_prob: 75, is_won: false, is_lost: false },
  { name: "Won",         position: 5, win_prob: 100, is_won: true,  is_lost: false },
  { name: "Lost",        position: 6, win_prob: 0,   is_won: false, is_lost: true  },
];

async function ensureDefaultPipeline(userId: number): Promise<Pipeline> {
  const q = sql();
  const existing = (await q`
    select id, owner_id, name, is_default, created_at, updated_at
    from pipelines
    where owner_id = ${userId} and deleted_at is null
    order by is_default desc, id asc
    limit 1
  `) as Pipeline[];
  if (existing[0]) return existing[0];

  const created = (await q`
    insert into pipelines (owner_id, name, is_default)
    values (${userId}, ${"Default"}, true)
    returning id, owner_id, name, is_default, created_at, updated_at
  `) as Pipeline[];
  const pipeline = created[0];
  for (const s of DEFAULT_STAGES) {
    await q`
      insert into pipeline_stages (pipeline_id, name, position, win_prob, is_won, is_lost)
      values (${pipeline.id}, ${s.name}, ${s.position}, ${s.win_prob}, ${s.is_won}, ${s.is_lost})
    `;
  }
  return pipeline;
}

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    await ensureDefaultPipeline(user.id);
    const q = sql();
    const pipelines = (user.role === "admin"
      ? await q`
          select id, owner_id, name, is_default, created_at, updated_at
          from pipelines
          where deleted_at is null
          order by id asc
        `
      : await q`
          select id, owner_id, name, is_default, created_at, updated_at
          from pipelines
          where owner_id = ${user.id} and deleted_at is null
          order by id asc
        `) as Pipeline[];
    const ids = pipelines.map((p) => p.id);
    const stages = ids.length === 0
      ? []
      : ((await q`
          select id, pipeline_id, name, position, win_prob, is_won, is_lost
          from pipeline_stages
          where pipeline_id = any(${ids}::int[])
          order by pipeline_id, position
        `) as Stage[]);
    return NextResponse.json({ pipelines, stages });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const body = (await req.json()) as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name) throw new Error("BAD_REQUEST");
    const q = sql();
    const created = (await q`
      insert into pipelines (owner_id, name)
      values (${user.id}, ${name})
      returning id, owner_id, name, is_default, created_at, updated_at
    `) as Pipeline[];
    for (const s of DEFAULT_STAGES) {
      await q`
        insert into pipeline_stages (pipeline_id, name, position, win_prob, is_won, is_lost)
        values (${created[0].id}, ${s.name}, ${s.position}, ${s.win_prob}, ${s.is_won}, ${s.is_lost})
      `;
    }
    return NextResponse.json({ pipeline: created[0] }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
