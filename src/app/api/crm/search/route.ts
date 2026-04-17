import { NextRequest, NextResponse } from "next/server";
import { sql, ensureSchema } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { requireCrmEnabled, statusForError } from "@/lib/crm/guard";

export const runtime = "nodejs";

interface ContactHit {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}
interface CompanyHit {
  id: number;
  name: string;
}
interface DealHit {
  id: number;
  title: string;
  amount: number;
}
interface QuotationHit {
  id: number;
  ref: string | null;
  project_name: string | null;
  client_name: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    await ensureSchema();
    await requireCrmEnabled();
    const url = new URL(req.url);
    const raw = (url.searchParams.get("q") ?? "").trim();
    if (raw.length < 2) {
      return NextResponse.json({
        contacts: [],
        companies: [],
        deals: [],
        quotations: [],
      });
    }
    // Build a prefix-friendly tsquery: split on whitespace, append :* to each
    // term, AND-combine. plainto_tsquery would lose prefix matching which is
    // critical for a Cmd+K palette where users type partial words.
    const tsq = raw
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/[^\w]/g, "") + ":*")
      .filter((t) => t.length > 2)
      .join(" & ");
    if (!tsq) {
      return NextResponse.json({
        contacts: [],
        companies: [],
        deals: [],
        quotations: [],
      });
    }
    const q = sql();
    const isAdmin = user.role === "admin";
    const uid = user.id;

    const [contacts, companies, deals, quotations] = await Promise.all([
      (isAdmin
        ? q`
            select id, first_name, last_name, email
            from contacts
            where deleted_at is null and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `
        : q`
            select id, first_name, last_name, email
            from contacts
            where deleted_at is null and owner_id = ${uid}
              and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `) as Promise<ContactHit[]>,
      (isAdmin
        ? q`
            select id, name
            from companies
            where deleted_at is null and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `
        : q`
            select id, name
            from companies
            where deleted_at is null and owner_id = ${uid}
              and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `) as Promise<CompanyHit[]>,
      (isAdmin
        ? q`
            select id, title, amount
            from deals
            where deleted_at is null and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `
        : q`
            select id, title, amount
            from deals
            where deleted_at is null and owner_id = ${uid}
              and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `) as Promise<DealHit[]>,
      (isAdmin
        ? q`
            select id, ref, project_name, client_name
            from quotations
            where deleted_at is null and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `
        : q`
            select id, ref, project_name, client_name
            from quotations
            where deleted_at is null and owner_id = ${uid}
              and search_tsv @@ to_tsquery('simple', ${tsq})
            limit 8
          `) as Promise<QuotationHit[]>,
    ]);

    return NextResponse.json({ contacts, companies, deals, quotations });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: statusForError(msg) });
  }
}
