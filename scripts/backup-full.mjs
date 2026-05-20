#!/usr/bin/env node
/**
 * Complete database backup to multiple formats + locations
 * Creates:
 *   1. JSON backup (human-readable, git-friendly)
 *   2. SQL dump (Postgres native format)
 *   3. CSV exports (for spreadsheet review)
 *
 * Usage:
 *   DATABASE_URL=postgres://… BACKUP_DIR=./backups node scripts/backup-full.mjs
 *
 * Stores in: ./backups/{timestamp}/
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { execSync } from "node:child_process";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!url) {
  console.error("❌ No Supabase connection string found. Set DATABASE_URL.");
  process.exit(1);
}

const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve("./backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
const backupPath = path.join(BACKUP_DIR, timestamp);

// Parse connection URL for pg_dump
const urlObj = new URL(url);
const pgDumpEnv = {
  ...process.env,
  PGPASSWORD: urlObj.password,
};

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function backupJsonFormat() {
  console.log("📄 Backing up: users (JSON)...");
  const users = await sql`SELECT * FROM users ORDER BY id`;
  fs.writeFileSync(
    path.join(backupPath, "users.json"),
    JSON.stringify(users, null, 2)
  );
  console.log(`   ✓ ${users.length} users exported`);

  console.log("📄 Backing up: quotations (JSON)...");
  const quotations = await sql`SELECT * FROM quotations ORDER BY id`;
  fs.writeFileSync(
    path.join(backupPath, "quotations.json"),
    JSON.stringify(quotations, null, 2)
  );
  console.log(`   ✓ ${quotations.length} quotations exported`);

  console.log("📄 Backing up: products (JSON)...");
  const products = await sql`SELECT * FROM products ORDER BY id`;
  fs.writeFileSync(
    path.join(backupPath, "products.json"),
    JSON.stringify(products, null, 2)
  );
  console.log(`   ✓ ${products.length} products exported`);

  // Write backup manifest
  const manifest = {
    backup_timestamp: new Date().toISOString(),
    backup_version: "1.0",
    tables: {
      users: users.length,
      quotations: quotations.length,
      products: products.length,
    },
  };
  fs.writeFileSync(
    path.join(backupPath, "MANIFEST.json"),
    JSON.stringify(manifest, null, 2)
  );
  console.log("✓ Manifest written");
}

async function backupCsvFormat() {
  console.log("\n📊 Backing up: users (CSV)...");
  const users = await sql`SELECT * FROM users ORDER BY id`;
  if (users.length > 0) {
    const headers = Object.keys(users[0]);
    const csv = [
      headers.join(","),
      ...users.map((u) =>
        headers
          .map((h) => {
            const v = u[h];
            if (v === null) return "";
            const str = String(v).replace(/"/g, '""');
            return `"${str}"`;
          })
          .join(",")
      ),
    ].join("\n");
    fs.writeFileSync(path.join(backupPath, "users.csv"), csv);
    console.log(`   ✓ ${users.length} users exported`);
  }

  console.log("📊 Backing up: quotations (CSV)...");
  const quotations = await sql`SELECT id, user_id, created_at, updated_at, title FROM quotations ORDER BY id`;
  if (quotations.length > 0) {
    const headers = Object.keys(quotations[0]);
    const csv = [
      headers.join(","),
      ...quotations.map((q) =>
        headers
          .map((h) => {
            const v = q[h];
            if (v === null) return "";
            const str = String(v).replace(/"/g, '""');
            return `"${str}"`;
          })
          .join(",")
      ),
    ].join("\n");
    fs.writeFileSync(path.join(backupPath, "quotations.csv"), csv);
    console.log(`   ✓ ${quotations.length} quotations exported`);
  }
}

async function backupSqlDump() {
  console.log("\n🗄️  Backing up: SQL dump...");
  try {
    const host = urlObj.hostname;
    const port = urlObj.port || 5432;
    const database = urlObj.pathname.slice(1);
    const user = urlObj.username;

    const dumpCmd = [
      "pg_dump",
      `-h ${host}`,
      `-p ${port}`,
      `-U ${user}`,
      "-d", database,
      "--no-password",
      "-F c", // Custom format (compressed)
    ].join(" ");

    execSync(dumpCmd, {
      stdio: ["pipe", "pipe", "pipe"],
      env: pgDumpEnv,
      cwd: backupPath,
    });

    // Also try text dump
    const textDumpCmd = [
      "pg_dump",
      `-h ${host}`,
      `-p ${port}`,
      `-U ${user}`,
      "-d", database,
      "--no-password",
    ].join(" ");

    const sqlText = execSync(textDumpCmd, {
      encoding: "utf-8",
      env: pgDumpEnv,
    });
    fs.writeFileSync(path.join(backupPath, "dump.sql"), sqlText);
    console.log("   ✓ SQL dump created (text + compressed)");
  } catch (err) {
    console.warn(
      "⚠️  pg_dump not available or failed. Continuing with JSON/CSV only."
    );
  }
}

async function createChecksum() {
  console.log("\n🔐 Creating checksums...");
  const crypto = await import("crypto");
  const files = fs.readdirSync(backupPath);
  const checksums = {};

  for (const file of files) {
    if (file === "checksums.json") continue;
    const filepath = path.join(backupPath, file);
    const content = fs.readFileSync(filepath);
    const hash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");
    checksums[file] = hash;
  }

  fs.writeFileSync(
    path.join(backupPath, "checksums.json"),
    JSON.stringify(checksums, null, 2)
  );
  console.log("   ✓ SHA256 checksums written");
}

async function createReadme() {
  const readme = `# Database Backup - ${timestamp}

## Contents

- **users.json** - User accounts (login credentials hashed)
- **quotations.json** - All saved quotations with full data
- **products.json** - Complete product catalog from DATABASE/
- **users.csv** - Users in spreadsheet format
- **quotations.csv** - Quotations metadata only (CSV safe)
- **dump.sql** - Full PostgreSQL native dump (for restore)
- **MANIFEST.json** - Row counts and metadata
- **checksums.json** - SHA256 hashes for integrity verification
- **restore-guide.md** - Instructions for restoring this backup

## Verification

To verify backup integrity:
\`\`\`bash
# Verify each file matches its checksum
while read -r file hash; do
  real_hash=$(sha256sum "$file" | awk '{print $1}')
  if [ "$real_hash" = "$hash" ]; then
    echo "✓ $file OK"
  else
    echo "❌ $file CORRUPTED"
  fi
done < checksums.json
\`\`\`

## Restore Instructions

See restore-guide.md for full details on:
1. Restoring to a new Supabase project
2. Restoring to Cloudflare D1
3. Partial restore (specific users/quotations)
`;

  fs.writeFileSync(path.join(backupPath, "README.md"), readme);
}

async function main() {
  try {
    console.log(`\n📦 Starting full database backup (${timestamp})\n`);
    await ensureDir(backupPath);

    await backupJsonFormat();
    await backupCsvFormat();
    await backupSqlDump();
    await createChecksum();
    await createReadme();

    console.log(`\n✅ Backup complete!\n`);
    console.log(`📍 Location: ${backupPath}\n`);
    console.log("📋 Files created:");
    fs.readdirSync(backupPath).forEach((f) => {
      const stat = fs.statSync(path.join(backupPath, f));
      const size = (stat.size / 1024).toFixed(2);
      console.log(`   ${f} (${size} KB)`);
    });
  } catch (err) {
    console.error("\n❌ Backup failed:", err.message);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
