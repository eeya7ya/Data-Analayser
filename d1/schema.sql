-- MagicTech SQLite schema for Cloudflare D1.
-- Regenerated from src/lib/db.ts (the Postgres bootstrap) — current as of
-- 2026-06-29. D1 is now the app's primary database; this file is the canonical
-- schema applied via POST /api/admin/d1-apply-schema (idempotent).
--
-- NOT a 1:1 port. Caveats:
--   - tsvector / generated search_tsv columns are SKIPPED (search uses ILIKE).
--   - jsonb / json / text[] columns become TEXT; the app stores JSON strings.
--   - now() / gen_random_uuid() / ::cast defaults are stripped; the app passes
--     explicit values (db-d1-sql.ts rewrites now() -> CURRENT_TIMESTAMP at run time).
--   - Foreign keys are declared as plain columns (D1 bulk-import runs with
--     PRAGMA foreign_keys = OFF).
--   - catalogue_* are legacy tables retained only to preserve any pre-existing
--     D1 data; the current app does not create or read them.
--
-- The ALTER TABLE ... ADD COLUMN block near the end brings an OLDER D1 database
-- (created before tenant_id / department_code / barcode / sales_project_id
-- existed) up to date in place. The apply-schema route ignores "duplicate
-- column name" so it is safe to re-run.
--
-- Apply with:
--   wrangler d1 execute magictech --remote --file=./d1/schema.sql
-- or POST /api/admin/d1-apply-schema (Admin → Backups → Reset/Sync D1).

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "activity_log" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "actor_id" INTEGER,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "verb" TEXT NOT NULL,
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" TEXT,
  "value" TEXT NOT NULL DEFAULT '{}',
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "calendar_marks" (
  "id" INTEGER,
  "user_id" INTEGER NOT NULL,
  "mark_date" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "color" TEXT NOT NULL DEFAULT 'red',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- LEGACY: not created or read by the current app. Retained to preserve any
-- pre-existing D1 rows.
CREATE TABLE IF NOT EXISTS "catalogue_items" (
  "id" INTEGER,
  "vendor" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "sub_category" TEXT,
  "model" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "description_locked" INTEGER DEFAULT 0 NOT NULL,
  "currency" TEXT NOT NULL,
  "price_dpp" REAL,
  "price_si" REAL,
  "price_end_user" REAL,
  "specs" TEXT NOT NULL,
  "active" INTEGER DEFAULT 1 NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- LEGACY: see note on catalogue_items.
CREATE TABLE IF NOT EXISTS "catalogue_jobs" (
  "id" INTEGER,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "total" INTEGER DEFAULT 0 NOT NULL,
  "done" INTEGER DEFAULT 0 NOT NULL,
  "error" TEXT,
  "payload" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- LEGACY: see note on catalogue_items.
CREATE TABLE IF NOT EXISTS "catalogue_price_history" (
  "id" INTEGER,
  "item_id" INTEGER NOT NULL,
  "price_dpp" REAL,
  "price_si" REAL,
  "price_end_user" REAL,
  "changed_by" INTEGER,
  "changed_at" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- LEGACY: see note on catalogue_items.
CREATE TABLE IF NOT EXISTS "catalogue_theory" (
  "id" INTEGER,
  "vendor" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- Syslog: every click is recorded here and auto-purged after 1 week
-- (see /api/syslog). user_id/username are denormalised for easy display.
CREATE TABLE IF NOT EXISTS "click_log" (
  "id" INTEGER,
  "user_id" INTEGER,
  "username" TEXT,
  "path" TEXT NOT NULL,
  "label" TEXT,
  "tag" TEXT,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "click_log_created_idx" ON "click_log" ("created_at");

CREATE TABLE IF NOT EXISTS "client_folders" (
  "id" INTEGER,
  "name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "owner_id" INTEGER,
  "client_email" TEXT,
  "client_phone" TEXT,
  "client_company" TEXT,
  "deleted_at" TEXT,
  "custom_fields" TEXT NOT NULL DEFAULT '{}',
  "kind" TEXT,
  "company_id" INTEGER,
  PRIMARY KEY ("id")
);

-- search_tsv (tsvector) dropped — search uses ILIKE.
CREATE TABLE IF NOT EXISTS "companies" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "folder_id" INTEGER,
  "name" TEXT NOT NULL,
  "website" TEXT,
  "industry" TEXT,
  "size_bucket" TEXT,
  "notes" TEXT,
  "custom_fields" TEXT NOT NULL DEFAULT '{}',
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- search_tsv (tsvector) dropped — search uses ILIKE.
CREATE TABLE IF NOT EXISTS "contacts" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "folder_id" INTEGER,
  "company_id" INTEGER,
  "first_name" TEXT,
  "last_name" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "title" TEXT,
  "notes" TEXT,
  "custom_fields" TEXT NOT NULL DEFAULT '{}',
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- search_tsv (tsvector) dropped — search uses ILIKE.
CREATE TABLE IF NOT EXISTS "deals" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "pipeline_id" INTEGER,
  "stage_id" INTEGER,
  "company_id" INTEGER,
  "contact_id" INTEGER,
  "folder_id" INTEGER,
  "quotation_id" INTEGER,
  "title" TEXT NOT NULL,
  "amount" REAL NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "probability" REAL NOT NULL DEFAULT 0,
  "expected_close_at" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "custom_fields" TEXT NOT NULL DEFAULT '{}',
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "email_server_config" (
  "id" INTEGER DEFAULT 1,
  "imap_host" TEXT NOT NULL DEFAULT '',
  "imap_port" INTEGER NOT NULL DEFAULT 993,
  "smtp_host" TEXT NOT NULL DEFAULT '',
  "smtp_port" INTEGER NOT NULL DEFAULT 465,
  "encryption" TEXT NOT NULL DEFAULT 'ssl_tls',
  "updated_at" TEXT NOT NULL,
  "updated_by" INTEGER,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "entity_acls" (
  "id" INTEGER,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "principal_kind" TEXT NOT NULL,
  "principal_id" INTEGER NOT NULL,
  "perm" TEXT NOT NULL DEFAULT 'view',
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "execution_reports" (
  "id" INTEGER,
  "project_id" INTEGER NOT NULL,
  "author_id" INTEGER,
  "kind" TEXT NOT NULL DEFAULT 'update',
  "progress" INTEGER,
  "body" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "installation_rates" (
  "id" INTEGER,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'meter',
  "unit_cost" REAL NOT NULL DEFAULT 0,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "active" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_events" (
  "id" INTEGER,
  "lead_id" INTEGER NOT NULL,
  "actor_id" INTEGER,
  "verb" TEXT NOT NULL,
  "message" TEXT,
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_messages" (
  "id" INTEGER,
  "lead_id" INTEGER,
  "sender_id" INTEGER,
  "recipient_id" INTEGER NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'general',
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "read_at" TEXT,
  "external_message_id" TEXT,
  "delivered_at" TEXT,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "leads" (
  "id" INTEGER,
  "ref" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'new',
  "created_by" INTEGER,
  "requested_timeline_at" TEXT,
  "presales_manager_id" INTEGER,
  "assigned_to_id" INTEGER,
  "assigned_at" TEXT,
  "company_id" INTEGER,
  "folder_id" INTEGER,
  "contact_id" INTEGER,
  "quotation_id" INTEGER,
  "quotation_sent_at" TEXT,
  "quotation_email_subject" TEXT,
  "quotation_email_body" TEXT,
  "outcome" TEXT,
  "outcome_by" INTEGER,
  "outcome_at" TEXT,
  "outcome_reason" TEXT,
  "boq_file_id" INTEGER,
  "boq_uploaded_at" TEXT,
  "execution_assignee_id" INTEGER,
  "sent_to_execution_at" TEXT,
  "project_id" INTEGER,
  "completed_at" TEXT,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "sales_project_id" INTEGER,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "migration_flags" (
  "key" TEXT,
  "ran_at" TEXT NOT NULL,
  PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "news_posts" (
  "id" INTEGER,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "audience_modules" TEXT NOT NULL DEFAULT '["all"]',
  "audience_roles" TEXT NOT NULL DEFAULT '["all"]',
  "pinned" INTEGER NOT NULL DEFAULT 0,
  "created_by" INTEGER,
  "created_at" TEXT NOT NULL,
  "expires_at" TEXT,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notes" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "author_id" INTEGER,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_state" (
  "id" INTEGER,
  "user_id" INTEGER NOT NULL,
  "notif_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" INTEGER,
  "user_id" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "read_at" TEXT,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pipeline_stages" (
  "id" INTEGER,
  "pipeline_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "win_prob" REAL NOT NULL DEFAULT 0,
  "is_won" INTEGER NOT NULL DEFAULT 0,
  "is_lost" INTEGER NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pipelines" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "name" TEXT NOT NULL,
  "is_default" INTEGER NOT NULL DEFAULT 0,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pricing_manufacturers" (
  "id" INTEGER,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "tag" TEXT,
  "created_by_user_id" INTEGER,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pricing_product_lines" (
  "id" INTEGER,
  "project_id" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "item_model" TEXT NOT NULL DEFAULT '',
  "price_usd" REAL NOT NULL DEFAULT 0,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "shipping_override" REAL,
  "customs_override" REAL,
  "shipping_rate_override" REAL,
  "customs_rate_override" REAL,
  "profit_rate_override" REAL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pricing_project_constants" (
  "id" INTEGER,
  "project_id" INTEGER NOT NULL,
  "currency_rate" REAL NOT NULL DEFAULT 0.710000,
  "shipping_rate" REAL NOT NULL DEFAULT 0.150000,
  "customs_rate" REAL NOT NULL DEFAULT 0.120000,
  "profit_margin" REAL NOT NULL DEFAULT 0.250000,
  "tax_rate" REAL NOT NULL DEFAULT 0.160000,
  "target_currency" TEXT NOT NULL DEFAULT 'JOD',
  "source_currency" TEXT NOT NULL DEFAULT 'USD',
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pricing_projects" (
  "id" INTEGER,
  "name" TEXT NOT NULL,
  "date" TEXT,
  "responsible_person" TEXT,
  "manufacturer_id" INTEGER NOT NULL,
  "user_id" INTEGER,
  "parent_project_id" INTEGER,
  "revision_number" INTEGER NOT NULL DEFAULT 1,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pricing_user_manufacturers" (
  "id" INTEGER,
  "user_id" INTEGER NOT NULL,
  "manufacturer_id" INTEGER NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'cyan',
  "tag" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "products" (
  "id" INTEGER,
  "vendor" TEXT NOT NULL,
  "system" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "sub_category" TEXT NOT NULL DEFAULT '',
  "fast_view" TEXT NOT NULL DEFAULT '',
  "model" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "price_si" REAL NOT NULL DEFAULT 0,
  "specifications" TEXT NOT NULL DEFAULT '',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "picture_url" TEXT,
  "barcode" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "project_assignments" (
  "id" INTEGER,
  "project_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "assigned_by" INTEGER,
  "location" TEXT,
  "start_date" TEXT,
  "end_date" TEXT,
  "notes" TEXT,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "project_files" (
  "id" INTEGER,
  "project_id" INTEGER NOT NULL,
  "owner_id" INTEGER,
  "kind" TEXT NOT NULL DEFAULT 'other',
  "filename" TEXT NOT NULL,
  "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "storage_path" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  "shared_to_projects" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "project_handoffs" (
  "id" INTEGER,
  "quotation_id" INTEGER,
  "project_id" INTEGER,
  "folder_id" INTEGER,
  "created_by" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'pending_assignment',
  "contact_name" TEXT,
  "contact_phones" TEXT,
  "site_address" TEXT,
  "location_lat" REAL,
  "location_lng" REAL,
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "notes" TEXT,
  "boq_snapshot" TEXT NOT NULL DEFAULT '[]',
  "assigned_user_id" INTEGER,
  "assigned_by" INTEGER,
  "assigned_at" TEXT,
  "completed_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "project_tasks" (
  "id" INTEGER,
  "project_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "done" INTEGER NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_by" INTEGER,
  "done_by" INTEGER,
  "done_at" TEXT,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "projects" (
  "id" INTEGER,
  "folder_id" INTEGER NOT NULL,
  "owner_id" INTEGER,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "quotation_id" INTEGER,
  "folder_id" INTEGER,
  "po_number" TEXT NOT NULL,
  "supplier" TEXT,
  "client_name" TEXT,
  "project_name" TEXT,
  "amount" REAL NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'JOD',
  "status" TEXT NOT NULL DEFAULT 'open',
  "notes" TEXT,
  "issued_at" TEXT,
  "expected_at" TEXT,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "project_id" INTEGER,
  PRIMARY KEY ("id")
);

-- search_tsv (tsvector) dropped — search uses ILIKE.
CREATE TABLE IF NOT EXISTS "quotations" (
  "id" INTEGER,
  "ref" TEXT NOT NULL,
  "owner_id" INTEGER,
  "project_name" TEXT NOT NULL,
  "client_name" TEXT,
  "client_email" TEXT,
  "client_phone" TEXT,
  "sales_engineer" TEXT,
  "prepared_by" TEXT,
  "tax_percent" REAL NOT NULL DEFAULT 16,
  "site_name" TEXT NOT NULL DEFAULT 'SITE',
  "items_json" TEXT NOT NULL DEFAULT '[]',
  "totals_json" TEXT NOT NULL DEFAULT '{}',
  "config_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "folder_id" INTEGER,
  "deleted_at" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "parent_ref" TEXT,
  "custom_fields" TEXT NOT NULL DEFAULT '{}',
  "company_id" INTEGER,
  "contact_id" INTEGER,
  "project_id" INTEGER,
  "sales_approved_by" INTEGER,
  "sales_approved_at" TEXT,
  "presales_approved_by" INTEGER,
  "presales_approved_at" TEXT,
  "approved_at" TEXT,
  "accepted_at" TEXT,
  "rejected_at" TEXT,
  "rejected_by" INTEGER,
  "rejected_reason" TEXT,
  "sales_outcome" TEXT,
  "sales_outcome_at" TEXT,
  "sales_outcome_by" INTEGER,
  "sales_outcome_reason" TEXT,
  "hold_transfer_at" TEXT,
  "transferred_at" TEXT,
  "sent_to_sales_at" TEXT,
  "sent_to_sales_by" INTEGER,
  "sales_accepted_at" TEXT,
  "sales_accepted_by" INTEGER,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quotation_change_requests" (
  "id" INTEGER,
  "quotation_id" INTEGER NOT NULL,
  "requested_by" INTEGER,
  "target_user_id" INTEGER,
  "note" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolved_by" INTEGER,
  "resolved_at" TEXT,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quotation_stock_checks" (
  "id" INTEGER,
  "quotation_id" INTEGER NOT NULL,
  "requested_by" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "items_json" TEXT NOT NULL,
  "reply_json" TEXT,
  "storage_notes" TEXT,
  "answered_by" INTEGER,
  "answered_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" INTEGER,
  "user_id" INTEGER NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_events" (
  "id" INTEGER,
  "event_uid" TEXT NOT NULL,
  "item_id" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "from_node_id" INTEGER,
  "to_node_id" INTEGER,
  "actor_id" INTEGER,
  "method" TEXT NOT NULL DEFAULT 'manual',
  "reason" TEXT,
  "occurred_at" TEXT NOT NULL,
  "recorded_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_item_settings" (
  "item_id" INTEGER,
  "reorder_point" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("item_id")
);

CREATE TABLE IF NOT EXISTS "stock_location_nodes" (
  "id" INTEGER,
  "parent_id" INTEGER,
  "name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_placements" (
  "item_id" INTEGER,
  "node_id" INTEGER,
  "qty" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("item_id", "node_id")
);

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "assignee_id" INTEGER,
  "entity_type" TEXT,
  "entity_id" INTEGER,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "due_at" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'open',
  "custom_fields" TEXT NOT NULL DEFAULT '{}',
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_members" (
  "team_id" INTEGER,
  "user_id" INTEGER,
  "role" TEXT NOT NULL DEFAULT 'member',
  "joined_at" TEXT NOT NULL,
  PRIMARY KEY ("team_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "teams" (
  "id" INTEGER,
  "name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "module" TEXT,
  "manager_user_id" INTEGER,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" INTEGER,
  "name" TEXT NOT NULL,
  "slug" TEXT,
  "plan" TEXT NOT NULL DEFAULT 'trial',
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_email_accounts" (
  "user_id" INTEGER,
  "email_address" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password_enc" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "last_test_ok" INTEGER,
  "last_tested_at" TEXT,
  "last_test_error" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("user_id")
);

CREATE TABLE IF NOT EXISTS "user_module_roles" (
  "user_id" INTEGER,
  "module" TEXT,
  "role" TEXT,
  "granted_by" INTEGER,
  "created_at" TEXT NOT NULL,
  "revoked_at" TEXT,
  "revoked_by" INTEGER,
  PRIMARY KEY ("user_id", "module", "role")
);

CREATE TABLE IF NOT EXISTS "user_notes" (
  "id" INTEGER,
  "user_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Untitled note',
  "body" TEXT NOT NULL DEFAULT '',
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" INTEGER,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "created_at" TEXT NOT NULL,
  "display_name" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT,
  "tenant_id" INTEGER,
  "department_code" TEXT NOT NULL DEFAULT '',
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id" INTEGER,
  "workflow_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ok',
  "message" TEXT,
  "meta_json" TEXT NOT NULL DEFAULT '{}',
  "ran_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflows" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "name" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL,
  "trigger_json" TEXT NOT NULL DEFAULT '{}',
  "actions_json" TEXT NOT NULL DEFAULT '[]',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "last_run_at" TEXT,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- ── In-place column upgrades ────────────────────────────────────────────────
-- Bring an OLDER D1 database (created before these columns existed) up to date.
-- Re-running is safe: the apply-schema route ignores "duplicate column name".
ALTER TABLE "users" ADD COLUMN "tenant_id" INTEGER;
ALTER TABLE "users" ADD COLUMN "department_code" TEXT NOT NULL DEFAULT '';
ALTER TABLE "leads" ADD COLUMN "sales_project_id" INTEGER;
ALTER TABLE "products" ADD COLUMN "barcode" TEXT;

COMMIT;
PRAGMA foreign_keys = ON;
