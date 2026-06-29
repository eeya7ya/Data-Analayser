# MagicTech — Operations & Handover Sheet

Everything built during the database recovery + hardening work, and exactly how
to switch each piece on, test it, and go live. Three independent features, each
behind its own switch so you can enable them one at a time.

---

## 0. Current stack (where things are now)

- **App hosting:** Vercel (Next.js, Node runtime).
- **Database:** Neon (serverless Postgres) — holds all your data after the recovery.
- **Files + images + backups:** Cloudflare R2.
- **D1:** holds a full copy of the data (schema + rows) and is ready to become
  the live database once the app engine is verified (see §4).
- **Supabase:** gone.

---

## 1. Environment variables (the control panel)

Set these in **Vercel → Project → Settings → Environment Variables → Production**.

| Variable | Purpose | Needed for |
|---|---|---|
| `DATABASE_URL` | Neon connection string (pooled) | the live app |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account | R2, D1 |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | R2 S3 key | R2 (files, backups, images) |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | R2 S3 secret | R2 |
| `CLOUDFLARE_R2_BUCKET` | R2 bucket (default `magictech-files`) | R2 |
| `CLOUDFLARE_D1_DATABASE_ID` | `385c686f-31a1-46cb-b2ee-a919472ad978` | D1 |
| `CLOUDFLARE_API_TOKEN` | token with **D1 Edit** | D1 |
| `CRON_SECRET` | protects the daily backup cron | §2 |
| `RESTORE_SECRET` | protects the one-shot restore endpoint | §5 (remove after use) |
| `OFFLOAD_QUOTATION_IMAGES` | `1` = images → R2 | §3 (off by default) |
| `USE_D1` | `1` = app uses D1 instead of Postgres | §4 (off by default) |

> After changing any env var you must **Redeploy** for it to take effect.

---

## 2. Daily automatic database backup → R2  ✅ built

Every day at **02:00 UTC** the full database is snapshotted and uploaded to R2.
Your "never get stranded again" safety net.

- **Turn on:** set `CRON_SECRET`, redeploy. (Cron schedule is in `vercel.json`.)
- **Test now:** open
  `https://<your-domain>/api/cron/db-backup?secret=<CRON_SECRET>`
  → `{ "ok": true, "uploaded": {...}, "rows": N }`.
- **Where:** R2 → `backups/db/<YYYY-MM-DD>.zip` and `backups/db/latest.zip`.
- **Restore from a backup:** Admin → Backups → "Restore from backup (.zip)"
  (download `latest.zip` from R2 first). It upserts every row; never deletes.

---

## 3. Quotation/catalogue image offload → R2  ✅ built (off by default)

Keeps Neon small: embedded base64 images (`items_json[].picture_url`,
`products.picture_url`) are uploaded to R2 on save (deduped by content hash)
and replaced with a small `/api/quote-img/<hash>` link.

- **Turn on:** set `OFFLOAD_QUOTATION_IMAGES=1` (R2 vars must be set), redeploy.
- **Test:** create/edit a quotation with an item photo → save → re-open it.
  The photo still shows (now served from R2). In Neon, that item's
  `picture_url` is now a short link, not a base64 blob.
- **Rollback:** set `OFFLOAD_QUOTATION_IMAGES=0`, redeploy. Old inline images
  still render; new behaviour reverts. Existing data is never touched.
- **Safety:** fail-safe — if R2 errors during a save, the image is kept inline.

---

## 4. Switch the database to Cloudflare D1  🟡 built, needs verification

Moves the app off Postgres onto free D1. The D1 **database is already built and
populated** (clean schema via `/api/admin/d1-apply-schema`; data from the
restore). What remains is verifying the **app engine** that talks to D1.

### How it's wired
- `USE_D1=1` makes `sql()` route every query through the D1 engine
  (`src/lib/db-d1-sql.ts`) instead of Postgres. **OFF by default**, so it changes
  nothing until you set it.

### What's covered
- Normal CRUD, lists, viewing/saving quotations, CRM, catalogue.
- Search (it's `ILIKE`-based → works on SQLite).
- JSON builders/aggregates (`jsonb_build_object`, `jsonb_agg`, `string_agg`, …).

### Known gaps to check (small, countable)
- Date functions `to_char` / `date_trunc` / `extract(... from)` — a few routes
  (pipeline-board, briefing, execution-reports/summary, assignments/schedule).
- `generate_series` (~5 sites), `jsonb_set` paths, and `q.begin` transactions
  (4 sites — D1 has no interactive transaction).

### How to test (do this on a PREVIEW, not production)
1. Scope `USE_D1=1` + the `CLOUDFLARE_*` D1 vars to a **Preview** deployment.
2. Open the preview URL and click through: dashboard, a client, open + save a
   quotation, search, the pipeline board.
3. Anything that errors points at one of the gaps above — fix that statement
   for SQLite, redeploy preview, retry. With an **empty** D1 the surface is
   small, so this is quick.

### Go live on D1 (only after the preview is clean)
1. Set `USE_D1=1` in **Production**, redeploy.
2. Confirm the live app works.
3. **Then** retire Neon (remove `DATABASE_URL`). Keep the daily R2 backup running.

> Reversible at every step: `USE_D1=0` + redeploy puts you back on Postgres, and
> Neon keeps all data until you deliberately delete it.

---

## 5. Emergency: re-import data from D1 into Postgres  ✅ built

If you ever need to rebuild a Postgres database from the D1 copy (what saved the
day during recovery):

- Endpoint: `POST|GET /api/admin/d1-restore-to-postgres?secret=<RESTORE_SECRET>`
- Drops FK constraints, copies every table D1 → Postgres (rehydrating any
  R2-overflowed cells), restores constraints. Idempotent.
- Standalone equivalent: `npm run db:restore-from-d1` (see `docs/recover-to-neon.md`).
- **Remove `RESTORE_SECRET`** when you're not actively using it.

---

## Quick reference — turn-on order

1. `CRON_SECRET` → daily backups running. (do first — pure safety)
2. `OFFLOAD_QUOTATION_IMAGES=1` → Neon stays lean.
3. `USE_D1=1` on a **preview** → test → fix gaps → `USE_D1=1` in production →
   retire Neon.
