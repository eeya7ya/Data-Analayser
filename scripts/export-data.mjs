#!/usr/bin/env node
// Export every populated table in the public schema to JSON.
// Usage: DATABASE_URL=postgres://... OUT_DIR=./export/projectname node scripts/export-data.mjs

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("Set DATABASE_URL");
  process.exit(1);
}
const outDir = process.env.OUT_DIR || "./export";
fs.mkdirSync(outDir, { recursive: true });

const sql = postgres(url, { ssl: "require", prepare: false, max: 1 });

const tables = await sql`
  select table_name from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE'
  order by table_name
`;

const summary = {};
for (const { table_name } of tables) {
  const rows = await sql`select * from ${sql(table_name)}`;
  if (rows.length === 0) continue;
  fs.writeFileSync(
    path.join(outDir, `${table_name}.json`),
    JSON.stringify(rows, null, 2),
  );
  summary[table_name] = rows.length;
  console.log(`  ${table_name}: ${rows.length} rows`);
}
fs.writeFileSync(path.join(outDir, "_summary.json"), JSON.stringify(summary, null, 2));
await sql.end();
console.log(`\nDone → ${outDir}`);
