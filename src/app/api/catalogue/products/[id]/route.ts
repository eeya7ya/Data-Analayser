import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Per-row catalogue edit endpoints. The bulk Excel upload at
 * `/api/catalogue/upload` is still the fastest way to rewrite hundreds of
 * rows at once, but admins also need surgical edits ("fix this one price",
 * "rename this model") without re-uploading the whole workbook. Both
 * handlers are admin-only — regular users can read the catalogue via the
 * GET endpoint but never mutate it.
 */

/** Writable columns — everything except the primary key and timestamps. */
const EDITABLE_FIELDS = [
  "vendor",
  "system",
  "category",
  "sub_category",
  "fast_view",
  "model",
  "description",
  "currency",
  "price_si",
  "specifications",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

type PatchBody = Partial<Record<EditableField, string | number | null>>;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    await ensureSchema();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as PatchBody;
    const q = sql();
    const rows = (await q`
      select * from products where id = ${id} limit 1
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return NextResponse.json({ error: "product not found" }, { status: 404 });
    }
    const existing = rows[0];

    // Only accept known editable fields; unknown keys are silently ignored so a
    // future client sending extra metadata doesn't blow up the request.
    const patched: Record<EditableField, string | number> = {
      vendor: String(existing.vendor ?? ""),
      system: String(existing.system ?? ""),
      category: String(existing.category ?? ""),
      sub_category: String(existing.sub_category ?? ""),
      fast_view: String(existing.fast_view ?? ""),
      model: String(existing.model ?? ""),
      description: String(existing.description ?? ""),
      currency: String(existing.currency ?? "USD"),
      price_si: Number(existing.price_si ?? 0),
      specifications: String(existing.specifications ?? ""),
    };
    for (const field of EDITABLE_FIELDS) {
      if (body[field] === undefined) continue;
      if (field === "price_si") {
        const n = Number(body.price_si);
        patched.price_si = Number.isFinite(n) && n >= 0 ? n : patched.price_si;
      } else {
        patched[field] = String(body[field] ?? "").trim();
      }
    }

    // `vendor` + `model` are required — the browser / upload paths also
    // enforce this, so reject a PATCH that would leave the row unusable.
    if (!patched.vendor || !patched.model) {
      return NextResponse.json(
        { error: "vendor and model are required" },
        { status: 400 },
      );
    }

    // Guard the model-unique index. If the admin renamed this row to an
    // already-taken model we surface a readable error instead of letting
    // the DB throw a raw constraint violation.
    if (patched.model !== existing.model) {
      const clash = (await q`
        select 1 from products
        where model = ${patched.model} and id <> ${id}
        limit 1
      `) as unknown as Array<Record<string, unknown>>;
      if (clash.length > 0) {
        return NextResponse.json(
          { error: `another product already uses model "${patched.model}"` },
          { status: 409 },
        );
      }
    }

    const updated = (await q`
      update products set
        vendor         = ${patched.vendor},
        system         = ${patched.system},
        category       = ${patched.category},
        sub_category   = ${patched.sub_category},
        fast_view      = ${patched.fast_view},
        model          = ${patched.model},
        description    = ${patched.description},
        currency       = ${patched.currency},
        price_si       = ${patched.price_si},
        specifications = ${patched.specifications},
        updated_at     = now()
      where id = ${id}
      returning *
    `) as Array<Record<string, unknown>>;
    return NextResponse.json({ product: updated[0] });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    return NextResponse.json({ error: msg || "update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    await ensureSchema();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const q = sql();
    const deleted = (await q`
      delete from products where id = ${id}
      returning id
    `) as Array<{ id: number }>;
    if (deleted.length === 0) {
      return NextResponse.json({ error: "product not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: deleted[0].id });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    if (msg === "FORBIDDEN")
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    return NextResponse.json({ error: msg || "delete failed" }, { status: 500 });
  }
}
