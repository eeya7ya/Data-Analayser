#!/usr/bin/env node
/**
 * Regenerate src/lib/d1Schema.generated.ts from d1/schema.sql.
 *
 * The runtime D1 schema bootstrap (src/lib/d1-schema.ts) reads the schema from
 * an EMBEDDED string constant rather than from disk, so it never depends on
 * fs.readFile / Next.js output file tracing bundling the .sql into every
 * serverless function. This script keeps that embedded copy in sync with the
 * canonical d1/schema.sql.
 *
 * Run after editing d1/schema.sql:
 *   node scripts/gen-d1-schema.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sqlPath = resolve(root, "d1/schema.sql");
const outPath = resolve(root, "src/lib/d1Schema.generated.ts");

const sql = readFileSync(sqlPath, "utf8");

const header = `// AUTO-GENERATED from d1/schema.sql — do not edit by hand.
// Embedded so the D1 schema bootstrap never depends on fs.readFile or
// Next.js output file tracing (which may not bundle the .sql for every
// serverless function). Regenerate with:
//   node scripts/gen-d1-schema.mjs
export const D1_SCHEMA_SQL = ${JSON.stringify(sql)};
`;

writeFileSync(outPath, header, "utf8");
console.log(
  `Wrote ${outPath} (${sql.length} chars of SQL from d1/schema.sql).`,
);
