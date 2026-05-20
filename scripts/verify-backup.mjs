#!/usr/bin/env node
/**
 * Verify backup integrity and completeness
 * Checks:
 *   1. All required files exist
 *   2. File checksums match
 *   3. JSON is valid
 *   4. Row counts are reasonable
 *   5. No corruption indicators
 *
 * Usage:
 *   node scripts/verify-backup.mjs ./backups/2024-xx-xx
 */
import fs from "node:fs";
import path from "node:path";

const backupPath = process.argv[2] || "./backups";

if (!fs.existsSync(backupPath)) {
  console.error(`❌ Backup not found: ${backupPath}`);
  process.exit(1);
}

const REQUIRED_FILES = [
  "users.json",
  "quotations.json",
  "products.json",
  "MANIFEST.json",
  "checksums.json",
  "README.md",
];

const OPTIONAL_FILES = ["users.csv", "quotations.csv", "dump.sql"];

async function verifyBackup() {
  console.log(`\n📊 Verifying backup: ${path.basename(backupPath)}\n`);

  let isValid = true;

  // 1. Check required files
  console.log("📋 Checking required files...");
  for (const file of REQUIRED_FILES) {
    const filepath = path.join(backupPath, file);
    if (fs.existsSync(filepath)) {
      const stat = fs.statSync(filepath);
      console.log(`  ✓ ${file} (${(stat.size / 1024).toFixed(1)} KB)`);
    } else {
      console.log(`  ❌ Missing: ${file}`);
      isValid = false;
    }
  }

  // 2. Check optional files
  console.log("\n📦 Optional files...");
  for (const file of OPTIONAL_FILES) {
    const filepath = path.join(backupPath, file);
    if (fs.existsSync(filepath)) {
      const stat = fs.statSync(filepath);
      console.log(`  ✓ ${file} (${(stat.size / 1024).toFixed(1)} KB)`);
    } else {
      console.log(`  - ${file} (not present)`);
    }
  }

  // 3. Verify checksums
  console.log("\n🔐 Verifying checksums...");
  try {
    const crypto = await import("crypto");
    const checksums = JSON.parse(
      fs.readFileSync(path.join(backupPath, "checksums.json"), "utf-8")
    );

    for (const [file, expectedHash] of Object.entries(checksums)) {
      if (file === "checksums.json") continue;
      const filepath = path.join(backupPath, file);
      if (!fs.existsSync(filepath)) continue;

      const content = fs.readFileSync(filepath);
      const actualHash = crypto
        .createHash("sha256")
        .update(content)
        .digest("hex");

      if (actualHash === expectedHash) {
        console.log(`  ✓ ${file}`);
      } else {
        console.log(`  ❌ ${file} - CORRUPTED (hash mismatch)`);
        isValid = false;
      }
    }
  } catch (err) {
    console.log(`  ⚠️  Could not verify checksums: ${err.message}`);
  }

  // 4. Validate JSON files
  console.log("\n✅ Validating JSON files...");
  const jsonFiles = ["users.json", "quotations.json", "products.json", "MANIFEST.json"];
  for (const file of jsonFiles) {
    const filepath = path.join(backupPath, file);
    if (!fs.existsSync(filepath)) continue;

    try {
      const data = JSON.parse(
        fs.readFileSync(filepath, "utf-8")
      );
      if (Array.isArray(data)) {
        console.log(`  ✓ ${file} (${data.length} items)`);
      } else if (typeof data === "object") {
        const keys = Object.keys(data).length;
        console.log(`  ✓ ${file} (${keys} keys)`);
      }
    } catch (err) {
      console.log(`  ❌ ${file} - Invalid JSON: ${err.message}`);
      isValid = false;
    }
  }

  // 5. Check manifest
  console.log("\n📈 Row counts from manifest...");
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backupPath, "MANIFEST.json"), "utf-8")
    );
    if (manifest.tables) {
      console.log(`  Users:       ${manifest.tables.users || 0}`);
      console.log(`  Quotations:  ${manifest.tables.quotations || 0}`);
      console.log(`  Products:    ${manifest.tables.products || 0}`);

      // Sanity checks
      if (manifest.tables.users === 0) {
        console.log(
          `  ⚠️  No users in backup (should have at least 1 admin)`
        );
      }
    }
  } catch (err) {
    console.log(`  ⚠️  Could not read manifest: ${err.message}`);
  }

  // 6. Size analysis
  console.log("\n📏 Total backup size...");
  let totalSize = 0;
  const files = fs.readdirSync(backupPath);
  for (const file of files) {
    const filepath = path.join(backupPath, file);
    const stat = fs.statSync(filepath);
    totalSize += stat.size;
  }
  console.log(`  ${(totalSize / 1024 / 1024).toFixed(2)} MB total`);

  // Final result
  console.log("\n" + "=".repeat(50));
  if (isValid) {
    console.log("✅ Backup is VALID and ready for migration!");
    console.log("\nNext steps:");
    console.log("1. Copy backups to multiple secure locations:");
    console.log("   - Local drive (external SSD)");
    console.log("   - GitHub (confidential branch)");
    console.log("   - Cloud storage (S3/Azure/GCP)");
    console.log("2. Test restore to staging environment");
    console.log("3. Migrate to Cloudflare D1");
  } else {
    console.log("⚠️  Backup has issues. Review above and retry.");
  }
  console.log("=".repeat(50) + "\n");

  return isValid ? 0 : 1;
}

verifyBackup()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("❌ Verification failed:", err.message);
    process.exit(1);
  });
