# MagicTech — AI Quotation Designer (Vercel 2026)

Professional low-current / ICT / AV / surveillance quotation designer. Powered
by Next.js 15 (App Router), **Supabase Postgres** (Pro plan, accessed via the
Supavisor transaction pooler), and Groq for fast AI inference with a live
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
- **Supabase Postgres.** Users and saved quotations are stored in Supabase
  (Pro plan). The app connects through the Supavisor **transaction pooler**
  on port 6543 so Vercel serverless functions don't exhaust the connection
  budget. The schema is bootstrapped automatically on first request (or via
  `npm run db:init`).
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
| `POSTGRES_URL` *or* `DATABASE_URL` | ✅     | Supabase **Transaction Pooler** (Supavisor) connection string — port 6543 (see below)   |
| `AUTH_SECRET`                    | ✅       | Long random string (>=32 chars) for JWT signing. Generate: `openssl rand -base64 48`    |
| `GROQ_API_KEY`                   | ✅       | Free at <https://console.groq.com/keys>                                                 |
| `GROQ_DESIGN_MODEL`              |          | Default `llama-3.3-70b-versatile`                                                       |
| `GROQ_WEB_MODEL`                 |          | Default `groq/compound` (agentic web search)                                            |
| `DEFAULT_ADMIN_USER`             |          | Default `admin`                                                                         |
| `DEFAULT_ADMIN_PASS`             |          | Default `admin123` — **change immediately after first login**                           |
| `NEXT_PUBLIC_SUPABASE_URL`       |          | Injected by the Vercel integration. Only used if you later add the client-side SDK      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  |          | Injected by the Vercel integration. Paired with the URL above for client-side SDK use   |
| `SUPABASE_SERVICE_ROLE_KEY`      |          | Injected by the Vercel integration. **Never expose to the browser.**                    |
| `GITHUB_REPO`                    |          | `owner/repo` that hosts `DATABASE/` — default this repo                                 |
| `GITHUB_BRANCH`                  |          | Default `claude/migrate-neon-to-supabase-a3m4d`                                         |
| `COMPANY_LOGO_URL`               |          | Raw GitHub URL for the Magic Tech logo (falls back to SVG)                              |

### How the Postgres URL is resolved

The app looks for these env vars in order and uses the first non-empty value:

1. `DATABASE_URL`            — set manually if you prefer explicit naming.
2. `POSTGRES_URL`            — **auto-injected by the Supabase→Vercel native
                                integration**, already pointing at the pooled
                                (transaction mode) endpoint. No action needed.
3. `POSTGRES_PRISMA_URL`     — same source, Prisma-flavoured.
4. `POSTGRES_URL_NON_POOLING` — last-resort direct connection. Not recommended
                                from a serverless function.

So if you installed the Supabase integration in Vercel (the screenshot shows
the full set: `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, etc.), you're already done —
just **redeploy** so the new env vars are picked up by the build.

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

## Deploy to Vercel with Supabase

Recommended path (what this project is wired for):

1. **Create the database.** In Supabase (Pro plan) create a new project in the
   region closest to your Vercel region (e.g. `eu-central-1` for `fra1`).
2. **Install the Supabase integration on Vercel.** Vercel → Integrations →
   Supabase → Add → link it to your Data-Analayser project. This
   automatically injects `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
   friends into Production, Preview, and Development — marked Sensitive.
3. **Remove any leftover Neon integration** on the Vercel project
   (Integrations → Neon → Disconnect) so no stale `DATABASE_URL` shadows the
   Supabase one.
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
- [ ] (Optional) Enable Supabase **Point-in-Time Recovery** (included in the
      Pro plan) and set a daily backup retention that suits your compliance.
- [ ] (Optional) Restrict the Supabase project's **Network Restrictions** to
      the Vercel egress IPs for your region.

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
    ├── db.ts (Supabase Postgres via postgres.js + Supavisor pooler)
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
  talking to Supabase via the Supavisor transaction pooler
- `@supabase/supabase-js` **2.x** — optional client for Realtime / Storage /
  Auth integrations (not required by the current code paths)
- `groq-sdk` **0.12** — Groq inference (free tier)
- `jose` **5** — JWT signing / verify (Edge-compatible)
- TypeScript **5.7**

---

## License

Proprietary — Magic Tech / Neogenesis.
