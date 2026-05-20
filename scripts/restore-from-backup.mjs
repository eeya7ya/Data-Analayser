#!/usr/bin/env node
/**
 * Restore database from backup (JSON/SQL format)
 * Supports:
 *   1. Restore to Supabase Postgres
 *   2. Restore to Cloudflare D1 (SQLite)
 *   3. Selective restore (users/quotations only)
 *
 * Usage:
 *   DATABASE_URL=postgres://… BACKUP_DIR=./backups/2024-xx-xx node scripts/restore-from-backup.mjs
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import postgres from "postgres";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!url) {
  console.error("❌ No Supabase connection string found. Set DATABASE_URL.");
  process.exit(1);
}

const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (q) => new Promise((resolve) => rl.question(q, resolve));

const sql = postgres(url, {
  ssl: "require",
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

async function verifyBackup(backupPath) {
  console.log("\n🔍 Verifying backup integrity...");
  const checksums = JSON.parse(
    fs.readFileSync(path.join(backupPath, "checksums.json"), "utf-8")
  );
  const crypto = await import("crypto");

  let allValid = true;
  for (const [file, expectedHash] of Object.entries(checksums)) {
    if (file === "checksums.json") continue;
    const filepath = path.join(backupPath, file);
    if (!fs.existsSync(filepath)) {
      console.log(`❌ Missing file: ${file}`);
      allValid = false;
      continue;
    }

    const content = fs.readFileSync(filepath);
    const actualHash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex");

    if (actualHash === expectedHash) {
      console.log(`✓ ${file}`);
    } else {
      console.log(`❌ ${file} - CORRUPTED (hash mismatch)`);
      allValid = false;
    }
  }

  if (!allValid) {
    throw new Error(
      "Backup verification failed. Some files are corrupted or missing."
    );
  }
  console.log("✓ All files verified");
}

async function restoreUsers(backupPath) {
  console.log("\n👥 Restoring users...");
  const users = JSON.parse(
    fs.readFileSync(path.join(backupPath, "users.json"), "utf-8")
  );

  // Clear existing (optional)
  const doDelete = await question("Clear existing users? (y/n): ");
  if (doDelete.toLowerCase() === "y") {
    await sql`DELETE FROM users`;
    console.log("✓ Cleared existing users");
  }

  // Insert users
  for (const user of users) {
    await sql`
      INSERT INTO users (id, username, password_hash, is_admin, created_at, updated_at)
      VALUES (${user.id}, ${user.username}, ${user.password_hash}, ${user.is_admin}, ${user.created_at}, ${user.updated_at})
      ON CONFLICT (id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        is_admin = excluded.is_admin,
        updated_at = excluded.updated_at
    `;
  }

  console.log(`✓ Restored ${users.length} users`);
}

async function restoreQuotations(backupPath) {
  console.log("\n📋 Restoring quotations...");
  const quotations = JSON.parse(
    fs.readFileSync(path.join(backupPath, "quotations.json"), "utf-8")
  );

  // Clear existing (optional)
  const doDelete = await question("Clear existing quotations? (y/n): ");
  if (doDelete.toLowerCase() === "y") {
    await sql`DELETE FROM quotations`;
    console.log("✓ Cleared existing quotations");
  }

  // Insert quotations
  for (const q of quotations) {
    await sql`
      INSERT INTO quotations (id, user_id, title, data, created_at, updated_at)
      VALUES (${q.id}, ${q.user_id}, ${q.title}, ${JSON.stringify(q.data)}, ${q.created_at}, ${q.updated_at})
      ON CONFLICT (id) DO UPDATE SET
        title = excluded.title,
        data = excluded.data,
        updated_at = excluded.updated_at
    `;
  }

  console.log(`✓ Restored ${quotations.length} quotations`);
}

async function restoreProducts(backupPath) {
  console.log("\n🛍️  Restoring products...");
  const products = JSON.parse(
    fs.readFileSync(path.join(backupPath, "products.json"), "utf-8")
  );

  // Clear existing (optional)
  const doDelete = await question("Clear existing products? (y/n): ");
  if (doDelete.toLowerCase() === "y") {
    await sql`DELETE FROM products`;
    console.log("✓ Cleared existing products");
  }

  // Batch insert
  for (let i = 0; i < products.length; i += 50) {
    const batch = products.slice(i, i + 50);
    await sql`
      insert into products ${sql(
        batch,
        "id",
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
        "created_at",
        "updated_at"
      )}
      on conflict (id) do update set
        vendor = excluded.vendor,
        system = excluded.system,
        category = excluded.category,
        sub_category = excluded.sub_category,
        fast_view = excluded.fast_view,
        model = excluded.model,
        description = excluded.description,
        currency = excluded.currency,
        price_si = excluded.price_si,
        specifications = excluded.specifications,
        updated_at = excluded.updated_at
    `;
    process.stdout.write(`\rRestored ${Math.min(i + 50, products.length)}/${products.length} products`);
  }
  console.log(`\n✓ Restored ${products.length} products total`);
}

async function main() {
  try {
    console.log("\n🔄 Database Restore Tool\n");

    // Find backup
    let backupPath = process.env.BACKUP_DIR;
    if (!backupPath || !fs.existsSync(backupPath)) {
      console.error(`❌ Backup directory not found: ${backupPath}`);
      process.exit(1);
    }

    if (fs.lstatSync(backupPath).isFile()) {
      backupPath = path.dirname(backupPath);
    }

    console.log(`📁 Using backup: ${path.basename(backupPath)}`);

    // Verify backup
    await verifyBackup(backupPath);

    // Choose what to restore
    console.log("\nWhat would you like to restore?");
    console.log("1. Users only");
    console.log("2. Quotations only");
    console.log("3. Products only");
    console.log("4. All (users + quotations + products)");
    const choice = await question("\nEnter choice (1-4): ");

    switch (choice) {
      case "1":
        await restoreUsers(backupPath);
        break;
      case "2":
        await restoreQuotations(backupPath);
        break;
      case "3":
        await restoreProducts(backupPath);
        break;
      case "4":
        await restoreUsers(backupPath);
        await restoreQuotations(backupPath);
        await restoreProducts(backupPath);
        break;
      default:
        console.error("Invalid choice");
        process.exit(1);
    }

    console.log("\n✅ Restore complete!");
  } catch (err) {
    console.error("\n❌ Restore failed:", err.message);
    process.exit(1);
  } finally {
    rl.close();
    await sql.end({ timeout: 5 });
  }
}

main();
