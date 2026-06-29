# Recovering the app onto Neon (after Supabase was deleted)

Your data is **safe in Cloudflare D1**. Supabase held no unique copy of the
rows once the D1 migration had run, so deleting it did not lose data — it only
disconnected the live app, which still expects a **Postgres** database.

**Neon** is serverless Postgres. The app speaks Postgres natively, so moving to
Neon needs **zero code changes** — we just rebuild the schema, copy the rows
back from D1, and point the app at Neon. The D1 copy stays untouched as a
backup.

---

## Step 1 — Create a Neon database

1. Go to <https://neon.tech> → sign up (free tier is enough) → **Create project**.
2. Region: pick the one closest to your users.
3. After it's created, open **Connection Details** and copy the connection
   string. Use the **pooled** connection (it contains `-pooler`), e.g.:

   ```
   postgres://<user>:<password>@ep-xxxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require
   ```

## Step 2 — Build the schema in Neon

The app creates all 33 tables automatically on first load (`ensureSchema()`).
Two ways to trigger it:

- **Easiest:** set `DATABASE_URL` to the Neon string in Vercel
  (Project → Settings → Environment Variables), redeploy, and open the site
  once. It will load **empty** — that's expected; the tables now exist.
- **Or locally:** `DATABASE_URL="postgres://…neon…" npm run db:init`

> The restore script refuses to run against a database with no schema, so this
> step can't be skipped by accident.

## Step 3 — Copy the data from D1 back into Neon

You can do this two ways. **Method A (recommended)** runs inside the deployed
app on Vercel — no local tools needed, and it works even from networks that
can't reach Cloudflare's API directly. **Method B** runs the script from a
computer with Node installed.

### Method A — trigger it from the deployed app (no local setup)

1. In Vercel → Project → Settings → Environment Variables (Production), add:
   ```
   CLOUDFLARE_ACCOUNT_ID      = 239f39ee7282d3f24a77177446962cf2
   CLOUDFLARE_D1_DATABASE_ID  = 385c686f-31a1-46cb-b2ee-a919472ad978
   CLOUDFLARE_API_TOKEN       = <your D1-Read token>
   RESTORE_SECRET             = <any long random string you choose>
   ```
   (Add `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` too
   only if the run reports R2-overflow rows.)
2. **Redeploy** so the new env vars take effect.
3. Trigger the restore by POSTing to the endpoint once — from a terminal:
   ```bash
   curl -X POST "https://<your-domain>/api/admin/d1-restore-to-postgres?secret=<RESTORE_SECRET>"
   ```
   (Or, if you're logged in as admin, any tool that can POST that URL works.)
4. It returns a JSON report: `{ totalLoaded, tables: [{ name, d1Rows, loaded }] }`.
   Refresh the app — your data is there.
5. **Afterwards:** remove `RESTORE_SECRET` from Vercel (and delete the
   Cloudflare token) so the one-shot endpoint can't be re-triggered.

### Method B — run the script locally

You need a Cloudflare API token with **D1 Read** (and R2 read keys only if any
row was offloaded to R2 — the script will tell you if so).

```bash
DATABASE_URL="postgres://…neon…?sslmode=require" \
CLOUDFLARE_ACCOUNT_ID="…" \
CLOUDFLARE_D1_DATABASE_ID="385c686f-31a1-46cb-b2ee-a919472ad978" \
CLOUDFLARE_API_TOKEN="…" \
# optional, only if the script reports R2-overflow rows:
CLOUDFLARE_R2_ACCESS_KEY_ID="…" \
CLOUDFLARE_R2_SECRET_ACCESS_KEY="…" \
npm run db:restore-from-d1
```

- Preview first without writing anything: prefix with `DRY_RUN=1`.
- The script prints a per-table report (`D1 rows` vs `loaded`) and is **safe to
  re-run** — every write is an upsert, so nothing duplicates.

Where to get the values:
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard URL, or Workers & Pages → right sidebar.
- `CLOUDFLARE_D1_DATABASE_ID` — already in `wrangler.toml` (shown above).
- `CLOUDFLARE_API_TOKEN` — dashboard → My Profile → API Tokens → Create Token →
  custom token with **Account › D1 › Read** (add **Workers R2 Storage › Read**
  too if overflow rows exist).

## Step 4 — Point the live app at Neon

In Vercel → Project → Settings → Environment Variables, set (Production):

```
DATABASE_URL = postgres://…neon…?sslmode=require
```

Remove any stale `POSTGRES_URL` / Supabase integration vars so they don't take
precedence, then **Redeploy**.

## Step 5 — Verify

- The site loads and shows your quotations, leads, projects, clients.
- Spot-check a few records against the D1 Studio view.
- Log in with your existing admin account (the `users` table came across in the
  restore).

---

### FAQ

**Do I still need the Cloudflare D1 code migration?**
No. Neon already gives you serverless Postgres with no code changes, which was
the whole goal. Keep D1 as a free backup; the heavy D1 rewrite is optional.

**Will I lose anything?**
No. Files (PDFs/photos/BOQs) live in Cloudflare R2 and were never in Supabase.
The database rows come back from D1 via this script.

**Is this reversible?**
Yes — it only writes into the new Neon database. D1 and R2 are read-only here.
