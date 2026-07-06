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
  "default_shipping_rate" REAL,
  "default_customs_rate" REAL,
  "default_profit_margin" REAL,
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
  "exec_status" TEXT NOT NULL DEFAULT 'none',
  "exec_submitted_at" TEXT,
  "exec_submitted_by" INTEGER,
  "exec_decided_at" TEXT,
  "exec_decided_by" INTEGER,
  "exec_reject_reason" TEXT,
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
  "scope_of_work" TEXT,
  "status" TEXT NOT NULL DEFAULT 'assigned',
  "company_name" TEXT,
  "client_name" TEXT,
  "contact_name" TEXT,
  "contact_email" TEXT,
  "contact_phone" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "checklist_templates" (
  "id" INTEGER,
  "name" TEXT NOT NULL,
  "items" TEXT NOT NULL DEFAULT '[]',
  "created_by" INTEGER,
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
  "exec_status" TEXT NOT NULL DEFAULT 'none',
  "exec_submitted_at" TEXT,
  "exec_submitted_by" INTEGER,
  "exec_decided_at" TEXT,
  "exec_decided_by" INTEGER,
  "exec_reject_reason" TEXT,
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
-- Executive-manager confirmation workflow (quotations + pricing_projects).
ALTER TABLE "quotations" ADD COLUMN "exec_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "quotations" ADD COLUMN "exec_submitted_at" TEXT;
ALTER TABLE "quotations" ADD COLUMN "exec_submitted_by" INTEGER;
ALTER TABLE "quotations" ADD COLUMN "exec_decided_at" TEXT;
ALTER TABLE "quotations" ADD COLUMN "exec_decided_by" INTEGER;
ALTER TABLE "quotations" ADD COLUMN "exec_reject_reason" TEXT;
ALTER TABLE "pricing_projects" ADD COLUMN "exec_status" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "pricing_projects" ADD COLUMN "exec_submitted_at" TEXT;
ALTER TABLE "pricing_projects" ADD COLUMN "exec_submitted_by" INTEGER;
ALTER TABLE "pricing_projects" ADD COLUMN "exec_decided_at" TEXT;
ALTER TABLE "pricing_projects" ADD COLUMN "exec_decided_by" INTEGER;
ALTER TABLE "pricing_projects" ADD COLUMN "exec_reject_reason" TEXT;
-- Project distribution (work orders) — enriched project_assignments.
ALTER TABLE "project_assignments" ADD COLUMN "scope_of_work" TEXT;
ALTER TABLE "project_assignments" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'assigned';
ALTER TABLE "project_assignments" ADD COLUMN "company_name" TEXT;
ALTER TABLE "project_assignments" ADD COLUMN "client_name" TEXT;
ALTER TABLE "project_assignments" ADD COLUMN "contact_name" TEXT;
ALTER TABLE "project_assignments" ADD COLUMN "contact_email" TEXT;
ALTER TABLE "project_assignments" ADD COLUMN "contact_phone" TEXT;
-- Per-manufacturer pricing defaults (decimals; NULL = fall back to globals).
ALTER TABLE "pricing_manufacturers" ADD COLUMN "default_shipping_rate" REAL;
ALTER TABLE "pricing_manufacturers" ADD COLUMN "default_customs_rate" REAL;
ALTER TABLE "pricing_manufacturers" ADD COLUMN "default_profit_margin" REAL;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- Ported 1:1 from the Postgres bootstrap in src/lib/db.ts so every WHERE /
-- JOIN / ORDER BY column the app actually filters on is backed by an index on
-- D1 too. Without these, D1 does a full table scan per query and bills every
-- scanned row (D1 prices on rows READ), which is the main cost risk as
-- catalogue_items/products grow. All are CREATE INDEX IF NOT EXISTS so the
-- apply-schema route is idempotent and never drops anything.
--
-- The four Postgres GIN tsvector search indexes (contacts/companies/deals/
-- quotations _search_idx) are deliberately NOT ported — free-text search on D1
-- uses FTS5 virtual tables instead (see src/lib/fts.ts), which the schema-split
-- loader in src/lib/d1-schema.ts cannot create. FTS5 is wired up separately at
-- bootstrap time.

-- activity_log: timeline by owner (newest first) and per-entity history.
CREATE INDEX IF NOT EXISTS "activity_log_owner_created_idx" ON "activity_log" ("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "activity_log_owner_verb_idx"    ON "activity_log" ("owner_id", "verb", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "activity_log_entity_idx"        ON "activity_log" ("entity_type", "entity_id", "created_at" DESC);

-- calendar_marks: the calendar reads a user's marks by date.
CREATE INDEX IF NOT EXISTS "calendar_marks_user_date_idx" ON "calendar_marks" ("user_id", "mark_date");

-- client_folders: list/scope by owner + soft-delete; lookups by kind.
CREATE INDEX IF NOT EXISTS "client_folders_owner_deleted_idx" ON "client_folders" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "client_folders_deleted_idx"       ON "client_folders" ("deleted_at");
CREATE INDEX IF NOT EXISTS "client_folders_kind_idx"          ON "client_folders" ("kind", "deleted_at");

-- companies: owner-scoped list + folder join.
CREATE INDEX IF NOT EXISTS "companies_owner_idx"  ON "companies" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "companies_folder_idx" ON "companies" ("folder_id");

-- contacts: owner-scoped list, folder/company joins, case-insensitive email lookup.
CREATE INDEX IF NOT EXISTS "contacts_owner_idx"           ON "contacts" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "contacts_folder_deleted_idx"  ON "contacts" ("folder_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "contacts_company_deleted_idx" ON "contacts" ("company_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "contacts_email_idx"           ON "contacts" (lower("email"));

-- deals: pipeline board reads by owner/status/stage/pipeline.
CREATE INDEX IF NOT EXISTS "deals_owner_status_idx"     ON "deals" ("owner_id", "status", "deleted_at");
CREATE INDEX IF NOT EXISTS "deals_stage_idx"            ON "deals" ("stage_id");
CREATE INDEX IF NOT EXISTS "deals_pipeline_deleted_idx" ON "deals" ("pipeline_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "deals_quotation_idx"        ON "deals" ("quotation_id");

-- entity_acls: permission lookups by entity and by principal.
CREATE UNIQUE INDEX IF NOT EXISTS "entity_acls_unique_idx" ON "entity_acls" ("entity_type", "entity_id", "principal_kind", "principal_id", "perm");
CREATE INDEX IF NOT EXISTS "entity_acls_principal_idx"     ON "entity_acls" ("principal_kind", "principal_id");

-- execution_reports: per-project feed, newest first.
CREATE INDEX IF NOT EXISTS "execution_reports_project_idx" ON "execution_reports" ("project_id", "created_at" DESC);

-- installation_rates: admin rate book, active rows by category order.
CREATE INDEX IF NOT EXISTS "installation_rates_cat_idx" ON "installation_rates" ("category", "sort") WHERE "active" = 1;

-- lead_events / lead_messages: per-lead timeline + recipient inbox.
CREATE INDEX IF NOT EXISTS "lead_events_lead_idx"        ON "lead_events" ("lead_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "lead_messages_recipient_idx" ON "lead_messages" ("recipient_id", "read_at", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "lead_messages_lead_idx"      ON "lead_messages" ("lead_id", "created_at" DESC);

-- leads: the leads list filters by status / creator / assignee / outcome /
-- execution owner, and joins by company / folder / quotation / sales project.
CREATE INDEX IF NOT EXISTS "leads_status_idx"        ON "leads" ("status", "deleted_at");
CREATE INDEX IF NOT EXISTS "leads_created_by_idx"    ON "leads" ("created_by", "deleted_at");
CREATE INDEX IF NOT EXISTS "leads_assigned_to_idx"   ON "leads" ("assigned_to_id", "status", "deleted_at");
CREATE INDEX IF NOT EXISTS "leads_outcome_idx"       ON "leads" ("outcome", "outcome_at");
CREATE INDEX IF NOT EXISTS "leads_execution_idx"     ON "leads" ("execution_assignee_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "leads_company_idx"       ON "leads" ("company_id");
CREATE INDEX IF NOT EXISTS "leads_folder_idx"        ON "leads" ("folder_id");
CREATE INDEX IF NOT EXISTS "leads_quotation_idx"     ON "leads" ("quotation_id");
CREATE INDEX IF NOT EXISTS "leads_sales_project_idx" ON "leads" ("sales_project_id");

-- news_posts: active feed, pinned first then newest.
CREATE INDEX IF NOT EXISTS "news_posts_active_idx" ON "news_posts" ("pinned" DESC, "created_at" DESC) WHERE "deleted_at" IS NULL;

-- notes: per-entity thread (newest first) + owner scope.
CREATE INDEX IF NOT EXISTS "notes_entity_idx" ON "notes" ("entity_type", "entity_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notes_owner_idx"  ON "notes" ("owner_id", "deleted_at");

-- notifications / notification_state: per-user bell, unread + recency.
CREATE INDEX IF NOT EXISTS "notifications_user_idx"         ON "notifications" ("user_id", "read_at", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notification_state_user_idx"    ON "notification_state" ("user_id");

-- pipelines / pipeline_stages: board scaffolding.
CREATE INDEX IF NOT EXISTS "pipelines_owner_idx"          ON "pipelines" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "pipeline_stages_pipeline_idx" ON "pipeline_stages" ("pipeline_id", "position");

-- pricing tool: manufacturers + projects + product lines.
CREATE INDEX IF NOT EXISTS "pricing_manufacturers_active_idx"    ON "pricing_manufacturers" ("deleted_at") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "pricing_user_manufacturers_user_idx" ON "pricing_user_manufacturers" ("user_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "pricing_projects_user_idx"           ON "pricing_projects" ("user_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "pricing_projects_manufacturer_idx"   ON "pricing_projects" ("manufacturer_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "pricing_product_lines_project_idx"   ON "pricing_product_lines" ("project_id");

-- products: catalogue browse by vendor/system, model lookups, barcode scans.
CREATE INDEX IF NOT EXISTS "products_vendor_system_idx" ON "products" ("vendor", "system");
CREATE INDEX IF NOT EXISTS "products_model_idx"         ON "products" ("model");
CREATE INDEX IF NOT EXISTS "products_barcode_idx"       ON "products" ("barcode") WHERE "barcode" IS NOT NULL;

-- project_assignments: by user and by project.
CREATE INDEX IF NOT EXISTS "project_assignments_user_idx"    ON "project_assignments" ("user_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "project_assignments_project_idx" ON "project_assignments" ("project_id", "deleted_at");

-- project_files: per-project listing, by kind, and cross-project shares.
CREATE INDEX IF NOT EXISTS "project_files_project_idx" ON "project_files" ("project_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "project_files_kind_idx"    ON "project_files" ("project_id", "kind", "deleted_at");
CREATE INDEX IF NOT EXISTS "project_files_shared_idx"  ON "project_files" ("project_id", "shared_to_projects", "deleted_at");

-- project_handoffs: execution queue by status / assignee / creator.
CREATE INDEX IF NOT EXISTS "project_handoffs_status_idx"   ON "project_handoffs" ("status") WHERE "status" = 'pending_assignment';
CREATE INDEX IF NOT EXISTS "project_handoffs_assignee_idx" ON "project_handoffs" ("assigned_user_id");
CREATE INDEX IF NOT EXISTS "project_handoffs_creator_idx"  ON "project_handoffs" ("created_by");

-- project_tasks: open checklist per project.
CREATE INDEX IF NOT EXISTS "project_tasks_project_idx" ON "project_tasks" ("project_id") WHERE "deleted_at" IS NULL;

-- projects: folder/owner scoped lists.
CREATE INDEX IF NOT EXISTS "projects_folder_idx" ON "projects" ("folder_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "projects_owner_idx"  ON "projects" ("owner_id", "deleted_at");

-- purchase_orders: owner list, quotation/folder/project joins, unique PO number.
CREATE INDEX IF NOT EXISTS "purchase_orders_owner_idx"            ON "purchase_orders" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "purchase_orders_quotation_idx"        ON "purchase_orders" ("quotation_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_folder_idx"           ON "purchase_orders" ("folder_id");
CREATE INDEX IF NOT EXISTS "purchase_orders_project_idx"          ON "purchase_orders" ("project_id");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_owner_number_idx" ON "purchase_orders" ("owner_id", "po_number") WHERE "deleted_at" IS NULL;

-- push_subscriptions: per-user device list.
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

-- quotation_change_requests: open requests by quotation and by target user.
CREATE INDEX IF NOT EXISTS "quotation_change_requests_q_idx"      ON "quotation_change_requests" ("quotation_id", "status");
CREATE INDEX IF NOT EXISTS "quotation_change_requests_target_idx" ON "quotation_change_requests" ("target_user_id", "status");

-- quotation_stock_checks: per-quotation history, status queue, one open per quote.
CREATE INDEX IF NOT EXISTS "quotation_stock_checks_q_idx"      ON "quotation_stock_checks" ("quotation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "quotation_stock_checks_status_idx" ON "quotation_stock_checks" ("status", "created_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "quotation_stock_checks_one_pending_idx" ON "quotation_stock_checks" ("quotation_id") WHERE "status" = 'pending';

-- quotations: the heaviest list table — owner/folder/project/contact scopes,
-- status + approval filters, parent-ref chains, and the hold sweep.
CREATE INDEX IF NOT EXISTS "quotations_owner_deleted_idx" ON "quotations" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "quotations_owner_status_idx"  ON "quotations" ("owner_id", "status");
CREATE INDEX IF NOT EXISTS "quotations_folder_idx"        ON "quotations" ("folder_id");
CREATE INDEX IF NOT EXISTS "quotations_project_idx"       ON "quotations" ("project_id");
CREATE INDEX IF NOT EXISTS "quotations_contact_idx"       ON "quotations" ("contact_id");
CREATE INDEX IF NOT EXISTS "quotations_deleted_idx"       ON "quotations" ("deleted_at");
CREATE INDEX IF NOT EXISTS "quotations_parent_ref_idx"    ON "quotations" ("parent_ref");
CREATE INDEX IF NOT EXISTS "quotations_approval_idx"      ON "quotations" ("approved_at", "accepted_at", "deleted_at");
CREATE INDEX IF NOT EXISTS "quotations_hold_due_idx"      ON "quotations" ("hold_transfer_at") WHERE "sales_outcome" = 'held' AND "transferred_at" IS NULL;

-- stock_*: location tree, per-item movement ledger, per-node placements.
CREATE INDEX IF NOT EXISTS "stock_location_nodes_parent_idx" ON "stock_location_nodes" ("parent_id");
CREATE INDEX IF NOT EXISTS "stock_events_item_idx"           ON "stock_events" ("item_id", "recorded_at" DESC);
CREATE INDEX IF NOT EXISTS "stock_placements_node_idx"       ON "stock_placements" ("node_id");

-- tasks: owner/assignee work lists, entity links, due-soon open tasks.
CREATE INDEX IF NOT EXISTS "tasks_owner_idx"        ON "tasks" ("owner_id", "status", "deleted_at");
CREATE INDEX IF NOT EXISTS "tasks_assignee_idx"     ON "tasks" ("assignee_id", "status", "deleted_at");
CREATE INDEX IF NOT EXISTS "tasks_entity_status_idx" ON "tasks" ("entity_type", "entity_id", "status");
CREATE INDEX IF NOT EXISTS "tasks_due_idx"          ON "tasks" ("due_at") WHERE "deleted_at" IS NULL AND "status" = 'open';

-- teams / team_members / roles.
CREATE INDEX IF NOT EXISTS "team_members_user_idx"        ON "team_members" ("user_id");
CREATE INDEX IF NOT EXISTS "team_members_team_idx"        ON "team_members" ("team_id");
CREATE INDEX IF NOT EXISTS "teams_module_idx"             ON "teams" ("module", "deleted_at");
CREATE INDEX IF NOT EXISTS "user_module_roles_module_idx" ON "user_module_roles" ("module", "role");
CREATE INDEX IF NOT EXISTS "user_module_roles_active_idx" ON "user_module_roles" ("user_id", "module") WHERE "revoked_at" IS NULL;

-- users: tenant scoping.
CREATE INDEX IF NOT EXISTS "users_tenant_idx" ON "users" ("tenant_id");

-- user_notes: per-user notepad, newest first.
CREATE INDEX IF NOT EXISTS "user_notes_user_idx" ON "user_notes" ("user_id", "deleted_at", "updated_at" DESC);

-- workflows: owner list + enabled scheduler scan + run history.
CREATE INDEX IF NOT EXISTS "workflows_owner_idx"        ON "workflows" ("owner_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "workflows_enabled_idx"      ON "workflows" ("enabled") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "workflow_runs_workflow_idx" ON "workflow_runs" ("workflow_id", "ran_at" DESC);

-- ── UNIQUE constraints the app's `INSERT ... ON CONFLICT (cols)` upserts rely
-- on. Postgres declares these as UNIQUE constraints; the SQLite port dropped
-- them, so on D1 those upserts failed with "ON CONFLICT clause does not match
-- any PRIMARY KEY or UNIQUE constraint" (e.g. Create user). SQLite honours a
-- UNIQUE INDEX as an ON CONFLICT target, so recreate each one here. (Tables
-- whose ON CONFLICT column-set already equals the PRIMARY KEY need nothing.)
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key"              ON "users" ("username");
CREATE UNIQUE INDEX IF NOT EXISTS "client_folders_owner_name_key"   ON "client_folders" ("owner_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_state_user_key_idx" ON "notification_state" ("user_id", "notif_key");
CREATE UNIQUE INDEX IF NOT EXISTS "pricing_user_manufacturers_uq"   ON "pricing_user_manufacturers" ("user_id", "manufacturer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "products_model_key"              ON "products" ("model");
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_marks_user_date_idx"    ON "calendar_marks" ("user_id", "mark_date");
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions" ("endpoint");

COMMIT;
PRAGMA foreign_keys = ON;
