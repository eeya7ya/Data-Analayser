# 🚀 Backup Quick Reference Card

**Print this and keep it handy during migration!**

---

## One-Time Setup

```bash
# Set your database connection (do this once)
export DATABASE_URL="postgres://user:password@host.supabasedev.com:6543/postgres"
```

---

## Daily Backup (Do This Daily)

```bash
npm run backup:full
```

✓ Creates full backup in `./backups/YYYY-MM-DD-HHMMSS/`

---

## Verify Backup Works

```bash
npm run backup:verify ./backups/YYYY-MM-DD-HHMMSS
```

✓ Must see: **`✅ Backup is VALID and ready for migration!`**

---

## Test Restore (Before Migration)

```bash
npm run backup:restore
# Choose: "4. All (users + quotations + products)"
```

✓ Verifies backup can actually be restored

---

## List All Backups

```bash
npm run backup:list
```

✓ Shows backup folder sizes and dates

---

## Copy to Cloud (3x Redundancy)

```bash
# Copy to AWS S3
aws s3 cp backups/ s3://your-bucket/data-analyzer/ --recursive

# Copy to GitHub (create branch)
git checkout -b backup/$(date +%Y-%m-%d)
git add backups/ -f
git commit -m "Full backup: $(date)"
git push origin backup/$(date +%Y-%m-%d)

# Copy to external drive (manual)
cp -r backups/ /media/usb-drive/backup-2026-05-20/
```

---

## Emergency Restore

```bash
# If something breaks:
npm run backup:restore

# Choose:
# "1. Users only" = just restore login accounts
# "2. Quotations only" = just restore projects
# "3. Products only" = just refresh product catalog
# "4. All" = complete restore
```

---

## During Migration to Cloudflare

```bash
# Before you switch:
npm run backup:full       # Final backup
npm run backup:verify     # Verify it's good

# Copy final backup to 3 places:
# 1. External drive
# 2. GitHub (backup/final-20260520 branch)
# 3. AWS S3 / Azure / GCP

# Then migrate to D1
wrangler d1 create data-analyzer
wrangler d1 execute data-analyzer < backups/latest/dump.sql

# Keep Supabase online for 30 days as fallback
```

---

## If Disaster Strikes

| Problem | Solution |
|---------|----------|
| **Lost a quotation** | `npm run backup:restore` → Choose "2. Quotations only" |
| **Database corrupted** | `npm run backup:restore` → Choose "4. All" |
| **Wrong data deleted** | Find backup from before deletion → `npm run backup:restore` |
| **Hacked/compromised** | Create new D1 → Restore from trusted backup |
| **Can't reach Supabase** | Use JSON files from backup to rebuild |

---

## Files You Get

```
backups/2026-05-20-100000/
├── users.json              # ← User accounts
├── quotations.json         # ← All saved quotations
├── products.json           # ← Product catalog
├── dump.sql                # ← Raw SQL dump
├── users.csv               # ← Users as spreadsheet
├── quotations.csv          # ← Quotations as spreadsheet
├── MANIFEST.json           # ← Metadata (row counts)
├── checksums.json          # ← SHA256 for verification
└── README.md               # ← Detailed guide
```

---

## 📋 Pre-Migration Checklist

- [ ] Day 1-7: Run `npm run backup:full` daily
- [ ] Day 7: `npm run backup:verify` on last backup ✓ PASS
- [ ] Day 7: `npm run backup:restore` test restore ✓ SUCCESS
- [ ] Day 7: Copy backups to S3, GitHub, external drive
- [ ] Day 8: Create Cloudflare D1 database
- [ ] Day 8: Restore to D1 staging
- [ ] Day 8: Test application on D1 (2-3 hours)
- [ ] Day 8: Switch to D1 production
- [ ] Day 30: Verify no issues, delete Supabase

---

## Environment Variables

```bash
# Always needed
DATABASE_URL="postgres://..."

# Optional (defaults to ./backups)
BACKUP_DIR="/mnt/backup/"

# For cloud uploads
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
AZURE_STORAGE_ACCOUNT="..."
GOOGLE_APPLICATION_CREDENTIALS="/path/to/key.json"
```

---

## Support

- 📖 Full guide: `BACKUP_AND_MIGRATION_GUIDE.md`
- 🛠️ Scripts in: `scripts/backup-*.mjs` and `scripts/restore-*.mjs`
- 📊 Status: All scripts tested and production-ready

---

**Keep this card safe!**  
Backup = Peace of mind 🛡️

```
Last Updated: 2026-05-20
Next Review: Before production migration
```
