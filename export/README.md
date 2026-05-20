# Data Export

Each subfolder holds a JSON snapshot of one Supabase project's `public` schema.
One file per table — re-import order should respect FK dependencies.

## Run the export

```bash
# Project 1 — supabase-fuchsia-pocket (main: 5 users, 94 quotations, 2194 products, ~18 MB each)
DATABASE_URL="postgres://..." OUT_DIR=./export/fuchsia-pocket npm run db:export

# Project 2 — supabase-charcoal-lever (1 user, 5 quotations, 6 projects)
DATABASE_URL="postgres://..." OUT_DIR=./export/charcoal-lever npm run db:export

# Project 3 — supabase-byzantine-window (different schema: 17 manufacturers, 519 product_lines, 360 audit_logs)
DATABASE_URL="postgres://..." OUT_DIR=./export/byzantine-window npm run db:export
```

The connection string is in Supabase → Project Settings → Database → Connection
string → URI. Use the direct connection (port 5432), not the pooler, so the
export can stream large tables.

## Output

Each project folder gets:
- `<table_name>.json` — array of row objects, one file per populated table
- `_summary.json` — `{ table: row_count }` for the whole snapshot

Empty tables are skipped. Re-running overwrites the files.

## Re-import to the new database

The schema for the new (Cloudflare) DB needs to exist first. Then:

```sql
-- For each <table>.json, the rows can be inserted with whatever your new DB's
-- bulk-insert tool is (D1's `wrangler d1 execute`, Postgres `\copy` from a
-- converted CSV, or a small node script that reads the JSON and INSERTs).
```

Foreign keys to be aware of in `fuchsia-pocket`:
- `users` → referenced by `quotations.user_id`, `activity_log.user_id`, `user_module_roles.user_id`
- `client_folders` → referenced by `projects.folder_id`, `quotations.folder_id`
- `pipelines` → referenced by `pipeline_stages.pipeline_id`, `deals.pipeline_id`
- `companies` → referenced by `contacts.company_id`, `deals.company_id`

Insert in this order: `users` → `companies` → `contacts` → `client_folders` →
`pipelines` → `pipeline_stages` → `projects` → `quotations` → `activity_log` →
everything else.
