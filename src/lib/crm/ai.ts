import { sql } from "@/lib/db";
import { groqClient, DESIGN_MODEL } from "@/lib/groq";

export interface ContactCtx {
  contact: {
    id: number;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    notes: string | null;
    company_id: number | null;
  };
  company?: { id: number; name: string; industry: string | null };
  recentActivity: { verb: string; created_at: string; entity_type: string }[];
  recentNotes: { body: string; created_at: string }[];
  openDeals: { id: number; title: string; amount: number; status: string }[];
}

export async function loadContactContext(id: number): Promise<ContactCtx | null> {
  const q = sql();
  const c = (await q`
    select id, first_name, last_name, email, phone, title, notes, company_id
    from contacts where id = ${id} and deleted_at is null
  `) as ContactCtx["contact"][];
  if (!c[0]) return null;
  let company: ContactCtx["company"] | undefined;
  if (c[0].company_id) {
    const co = (await q`
      select id, name, industry from companies where id = ${c[0].company_id}
    `) as Array<{ id: number; name: string; industry: string | null }>;
    company = co[0];
  }
  const recentActivity = (await q`
    select verb, created_at, entity_type
    from activity_log
    where (entity_type = 'contact' and entity_id = ${id})
       or (entity_type = 'deal' and entity_id in
            (select id from deals where contact_id = ${id} and deleted_at is null))
    order by created_at desc
    limit 20
  `) as ContactCtx["recentActivity"];
  const recentNotes = (await q`
    select body, created_at from notes
    where entity_type = 'contact' and entity_id = ${id} and deleted_at is null
    order by created_at desc limit 10
  `) as ContactCtx["recentNotes"];
  const openDeals = (await q`
    select id, title, amount, status from deals
    where contact_id = ${id} and deleted_at is null
    order by updated_at desc limit 10
  `) as ContactCtx["openDeals"];
  return { contact: c[0], company, recentActivity, recentNotes, openDeals };
}

export async function chatJson(prompt: string, system: string): Promise<string> {
  const groq = groqClient();
  const res = await groq.chat.completions.create({
    model: DESIGN_MODEL(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
    max_tokens: 600,
  });
  return res.choices[0]?.message?.content ?? "";
}
