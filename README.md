# MagicTech — AI Quotation Designer (Cloudflare Workers)

Professional low-current / ICT / AV / surveillance quotation designer. Powered
by Next.js 15 (App Router), **Postgres** (any provider, accessed via a
transaction pooler), and Groq for fast AI inference with a live
agentic web-search fallback. All catalogs are pulled in real time from the
`DATABASE/` folder of this same GitHub repo — no database seeding required for
product data.

![Quotation preview](./DATABASE) <!-- placeholder -->

---

## Highlights

- **Smart by default.** Describe the project in one sentence; the AI designs
  the Bill of Quantities using the catalog and only asks clarifying questions
  when a parameter would drastically change the selection.
- **Live GitHub catalog.** JSON product DBs live in `DATABASE/` and are
  fetched at request time from `raw.githubusercontent.com`. Push a new model,
  it's instantly available.
- **Groq free tier.** Uses `llama-3.3-70b-versatile` for design. For deeper
  lookups that the local catalog can't answer, escalates to Groq's agentic
  `compound-beta` model which performs live web search internally.
- **Postgres.** Users and saved quotations are stored in Postgres (any
  provider — Neon, RDS, self-hosted, …). The app connects through a
  **transaction pooler** (e.g. port 6543) so Vercel serverless functions
  don't exhaust the connection budget. The schema is bootstrapped
  automatically on first request (or via `npm run db:init`).
- **Auth.** HttpOnly JWT cookies signed with `jose`. Default admin on first
  boot is `admin / admin123` — change it immediately. Admins create further
  users from the Admin page.
- **Printable quotation.** Styled to exactly match the Magic Tech Sales
  Quotation layout (Aqaba example). Click **Print / PDF** to export.

---

## Environment variables

Copy `.env.example` to `.env.local` (locally) or add to your Vercel project
settings:

| Variable                         | Required | Description                                                                             |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `POSTGRES_URL` *or* `DATABASE_URL` | ✅     | Pooled Postgres connection string (transaction pooler, e.g. port 6543) — see below      |
| `AUTH_SECRET`                    | ✅       | Long random string (>=32 chars) for JWT signing. Generate: `openssl rand -base64 48`    |
| `GROQ_API_KEY`                   | ✅       | Free at <https://console.groq.com/keys>                                                 |
| `GROQ_DESIGN_MODEL`              |          | Default `llama-3.3-70b-versatile`                                                       |
| `GROQ_WEB_MODEL`                 |          | Default `groq/compound` (agentic web search)                                            |
| `DEFAULT_ADMIN_USER`             |          | Default `admin`                                                                         |
| `DEFAULT_ADMIN_PASS`             |          | Default `admin123` — **change immediately after first login**                           |
| `GITHUB_REPO`                    |          | `owner/repo` that hosts `DATABASE/` — default this repo                                 |
| `GITHUB_BRANCH`                  |          | Branch that hosts `DATABASE/`                                                            |
| `COMPANY_LOGO_URL`               |          | Raw GitHub URL for the Magic Tech logo (falls back to SVG)                              |

### How the Postgres URL is resolved

The app looks for these env vars in order and uses the first non-empty value:

1. `DATABASE_URL`            — set manually if you prefer explicit naming.
2. `POSTGRES_URL`            — common alias; some Vercel Postgres integrations
                                inject this automatically at the pooled
                                (transaction mode) endpoint.
3. `POSTGRES_PRISMA_URL`     — same source, Prisma-flavoured.
4. `POSTGRES_URL_NON_POOLING` — last-resort direct connection. Not recommended
                                from a serverless function.

So if your host's Postgres integration injects `POSTGRES_URL` (pooled), you're
already done — just **redeploy** so the new env vars are picked up by the build.

> ⚠  Use the **transaction pooler** (the `POSTGRES_URL`, port 6543), not
> `POSTGRES_URL_NON_POOLING`. The app is configured with `prepare: false` and
> `max: 1` for pgbouncer-in-transaction-mode and will exhaust direct
> connections under serverless load.

---

## Local dev

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL, AUTH_SECRET, GROQ_API_KEY
npm run manifest:build       # regenerate DB manifest (only after editing DATABASE/)
npm run db:init              # bootstrap users + quotations tables (optional)
npm run dev
```

Open <http://localhost:3000>, sign in as `admin / admin123`, and go.

## Deploy to Cloudflare Workers

This is the current hosting target. The app is built into a Worker by the
[OpenNext](https://opennext.js.org/cloudflare) adapter, so the 105 route
handlers that declare `runtime = "nodejs"` keep running on the Node.js runtime
unchanged — no rewrite to the edge runtime was needed.

The database (D1) and file storage (R2) were already on Cloudflare before this
migration and **do not move**. Nothing is migrated, copied, or re-imported, so
there is no data-loss risk in the cutover itself.

### One-time setup

```bash
npx wrangler login
npx wrangler r2 bucket create magictech-opennext-cache   # Next's incremental cache
```

The cache deliberately uses its **own** bucket so cache objects never land in
the nightly DB/files backups or the off-site mirror.

You also need the **Workers Paid** plan ($5/mo): the bundle is ~4.1 MB
compressed, over the 3 MB free-tier ceiling (the paid ceiling is 10 MB).

### Secrets

Set each with `npx wrangler secret put <NAME>`. Which ones you must carry over
from the old host, and which you can simply regenerate:

| Secret | Where it comes from |
| --- | --- |
| `AUTH_SECRET` | **Copy from the old host.** Regenerating it logs everyone out (accounts and hashed passwords survive — it only invalidates existing session JWTs). |
| `EMAIL_ENCRYPTION_KEY` | Copy if you still have it. If not, generate a new one (`openssl rand -base64 32`) — see the warning below. |
| `CRON_SECRET` | Regenerate freely — any random string. Must be set or the nightly backup is skipped. |
| `GROQ_API_KEY` | Regenerate at the Groq console. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Regenerate with `npm run vapid:gen`. Existing push subscriptions stop working and users re-enable notifications. |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` / `CLOUDFLARE_ACCOUNT_ID` | Regenerate in the Cloudflare dashboard (R2 → Manage API tokens). Still required: R2 presigned upload URLs need SigV4 signing, which bindings cannot do. |

Plain (non-secret) vars go in `wrangler.toml` under `[vars]` — notably
`APP_ORIGIN`, the deployed URL, used for absolute self-links.

**D1 needs no credentials at all.** It is reached through the native binding
(`env.magictech`), so `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_D1_DATABASE_ID`
are only needed if you run the REST fallback (local scripts, or a non-Workers
host).

> **If `EMAIL_ENCRYPTION_KEY` is lost:** mailbox passwords in the database were
> encrypted with it (AES-256-GCM) and cannot be recovered — that key is the only
> thing that can decrypt them. Everything else in the database is unaffected.
> The app handles this cleanly rather than crashing: affected accounts return
> HTTP 409 with `credentialsStale: true` and a message telling the user to
> re-enter the mailbox password, which re-encrypts it under the new key.

### Build and deploy

```bash
npm run cf:build     # next build + OpenNext bundle
npm run cf:preview   # run the built Worker locally in workerd
npm run cf:deploy    # upload
```

### Cron

The nightly DB backup runs from `wrangler.toml → [triggers] crons` at 02:00
UTC. Cloudflare cron triggers invoke the Worker's `scheduled()` handler rather
than making an HTTP request, so `worker-entry.mjs` implements `scheduled()` and
calls the existing `/api/cron/db-backup` route with the same
`Authorization: Bearer $CRON_SECRET` header Vercel used to inject. The backup
logic itself is unchanged and there is still exactly one code path for it.

### After cutover

`vercel.json` is kept so you can roll back by re-pointing DNS. Once you're
happy, **pause or delete the Vercel project** — otherwise both hosts run the
daily backup cron. (They write the same R2 keys, so it's idempotent rather than
harmful, just wasteful.)

Verify against a real mailbox after the first deploy: outbound TCP is the one
thing that cannot be tested outside Cloudflare's network. Use SMTP port **587**
or **465** — Cloudflare blocks outbound port 25.

---

## Deploy to Vercel (legacy)

The app ran on Vercel until the Cloudflare migration above. Kept for reference
and rollback.

Recommended path:

1. **Provision a Postgres database** with any provider (Neon, RDS,
   self-hosted, …) in the region closest to your Vercel region (e.g.
   `eu-central-1` for `fra1`). Grab its **pooled** (transaction-mode)
   connection string.
2. **Set the connection string** in Vercel → Project Settings → Environment
   Variables as `DATABASE_URL` (or `POSTGRES_URL`) for Production, Preview and
   Development — marked Sensitive. (If your provider offers a Vercel
   integration that injects `POSTGRES_URL`, that works too.)
4. **Add the remaining secrets** in Vercel → Project Settings → Environment
   Variables (Production + Preview + Development, marked **Sensitive**):
   - `AUTH_SECRET` — `openssl rand -base64 48`
   - `GROQ_API_KEY`
   - plus any optional vars from the table above
5. **Redeploy.** Crucial — env vars added after the last build are only
   picked up on the next deploy. Either push a commit or use
   Vercel → Deployments → … → **Redeploy**.
6. On the first authenticated request `ensureSchema()` bootstraps the `users`
   and `quotations` tables and seeds the default admin.
7. **Log in** at `/login` as `admin / admin123`, open `/admin`, and rotate
   the admin password immediately.

### Security checklist

- [x] TLS enforced (`ssl: "require"` in the postgres client).
- [x] All secrets live only in Vercel env vars — never committed.
- [x] JWT sessions are `httpOnly`, `sameSite=lax`, and `secure` in production.
- [x] PBKDF2-SHA256 with 120 000 iterations for password hashing.
- [x] Serverless-safe connection settings (`prepare: false`, `max: 1`) for the
      Supavisor transaction pooler.
- [ ] Rotate the default admin password on first login.
- [ ] (Optional) Enable your Postgres provider's **point-in-time recovery /
      backups** with a retention that suits your compliance.
- [ ] (Optional) Restrict your database's **network access** to the Vercel
      egress IPs for your region.

---

## Flow

1. **Login** — `/login` · default `admin / admin123`.
2. **Designer** — `/designer`
   - Pick a system (e.g. `HIKVISION · IP Cameera`) or leave on **Auto** for
     cross-vendor.
   - Describe the project in one sentence.
   - The AI either:
     - Answers directly with a BoQ, or
     - Asks up to 3 targeted clarifying questions — you answer inline and
       re-run.
   - The quotation preview on the right is live-editable.
   - "Deep web search" routes to Groq's agentic `compound-beta` model with
     live browsing.
3. **Save & Open printable** — stores in Postgres and opens the print-ready
   view at `/quotation?id=...`.
4. **Admin · Users** — `/admin` (admins only) · create or remove users.

---

## DATABASE/ folder

Mirrors your Magic Tech catalog exactly. Each category contains:

- `*_db.json` — the products with pricing.
- `*_selection_theory.json` — engineering selection criteria used by the AI
  as grounded context.

Currently indexed (auto-generated by `npm run manifest:build` into
`src/lib/manifest.generated.ts`):

```
ARUBA, Cables, DSPPA (AMPLIFIERS, Accessories, Conference, IP Network,
MATRIX, misc, PAVA, SPEAKERS), ESVIZ, Extreme cabinet, fanvil,
General Accessories, HIKVISION (Access Control, Alarm, Analog Cameras,
Cables, DVR-NVR, Gates Barrier, HDD, Interactive Screen, Intercom,
IP Camera, MIXED, Monitors, PTZ, Switches, Turnstile, Video wall),
LEGREND, PLANET, SCHENIDER, SIB, TENDA, Yeastar
```

---

## Architecture

```
src/
├── app/
│   ├── layout.tsx, globals.css, page.tsx
│   ├── login/          → /login (server component + LoginForm client)
│   ├── designer/       → /designer (Groq-driven designer)
│   ├── quotation/      → /quotation[?id=] list + printable view
│   ├── admin/          → /admin users management
│   └── api/
│       ├── auth/{login,logout,me}/route.ts
│       ├── users/route.ts
│       ├── database/{systems,manifest,search}/route.ts
│       ├── groq/{design,web}/route.ts
│       └── quotations/route.ts
├── components/
│   ├── LoginForm.tsx, TopBar.tsx, UserManager.tsx
│   ├── Designer.tsx (main designer UX)
│   └── QuotationPreview.tsx, QuotationViewer.tsx
└── lib/
    ├── db.ts (Postgres via postgres.js + transaction pooler)
    ├── auth.ts (JWT + PBKDF2)
    ├── github.ts (raw JSON loader with Next fetch cache)
    ├── search.ts (smart scored search over JSON DBs)
    ├── groq.ts (Groq SDK client + system prompts)
    └── manifest.generated.ts (auto-generated from DATABASE/)
```

---

## Tech stack (2026)

- Next.js **15.5** · App Router · Server Actions enabled
- React **19**
- Tailwind CSS **3.4**
- `postgres` **3.4** (porsager/postgres) — type-safe tagged-template driver
  talking to Postgres via a transaction pooler
- `groq-sdk` **0.12** — Groq inference (free tier)
- `jose` **5** — JWT signing / verify (Edge-compatible)
- TypeScript **5.7**

---

## License

Proprietary — Magic Tech / Neogenesis.
