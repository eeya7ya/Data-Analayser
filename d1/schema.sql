-- MagicTech SQLite schema for Cloudflare D1.
-- Auto-translated from the live Supabase Postgres schema on 2026-05-20.
--
-- NOT a 1:1 port. Caveats:
--   - tsvector / generated FTS columns are SKIPPED. src/lib/search.ts
--     needs rewriting against SQLite FTS5 virtual tables.
--   - jsonb / json / text[] columns become TEXT. App queries using
--     ->> / @> need rewriting to json_extract() / json_each().
--   - now() / gen_random_uuid() / ::cast defaults are stripped; the
--     app code must pass explicit values on INSERT.
--   - Foreign keys are declared but NOT enforced during bulk-import
--     (PRAGMA off); will enable post-load.
--
-- Apply with:
--   wrangler d1 execute magictech --remote --file=./d1/schema.sql

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "activity_log" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "actor_id" INTEGER,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "verb" TEXT NOT NULL,
  "meta_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" TEXT,
  "value" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("key")
);

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

CREATE TABLE IF NOT EXISTS "catalogue_theory" (
  "id" INTEGER,
  "vendor" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

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
  "custom_fields" TEXT NOT NULL,
  "kind" TEXT,
  "company_id" INTEGER,
  PRIMARY KEY ("id")
);

-- NOTE: skipped tsvector column(s) on companies: search_tsv -- needs FTS5 rewrite
CREATE TABLE IF NOT EXISTS "companies" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "folder_id" INTEGER,
  "name" TEXT NOT NULL,
  "website" TEXT,
  "industry" TEXT,
  "size_bucket" TEXT,
  "notes" TEXT,
  "custom_fields" TEXT NOT NULL,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- NOTE: skipped tsvector column(s) on contacts: search_tsv -- needs FTS5 rewrite
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
  "custom_fields" TEXT NOT NULL,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

-- NOTE: skipped tsvector column(s) on deals: search_tsv -- needs FTS5 rewrite
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
  "amount" REAL DEFAULT 0 NOT NULL,
  "currency" TEXT NOT NULL,
  "probability" REAL DEFAULT 0 NOT NULL,
  "expected_close_at" TEXT,
  "status" TEXT NOT NULL,
  "custom_fields" TEXT NOT NULL,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "entity_acls" (
  "id" INTEGER,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "principal_kind" TEXT NOT NULL,
  "principal_id" INTEGER NOT NULL,
  "perm" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_events" (
  "id" INTEGER,
  "lead_id" INTEGER NOT NULL,
  "actor_id" INTEGER,
  "verb" TEXT NOT NULL,
  "message" TEXT,
  "meta_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_messages" (
  "id" INTEGER,
  "lead_id" INTEGER,
  "sender_id" INTEGER,
  "recipient_id" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
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
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL,
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
  "audience_modules" TEXT NOT NULL,
  "audience_roles" TEXT NOT NULL,
  "pinned" INTEGER DEFAULT 0 NOT NULL,
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

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" INTEGER,
  "user_id" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "link" TEXT,
  "payload" TEXT NOT NULL,
  "read_at" TEXT,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pipeline_stages" (
  "id" INTEGER,
  "pipeline_id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER DEFAULT 0 NOT NULL,
  "win_prob" REAL DEFAULT 0 NOT NULL,
  "is_won" INTEGER DEFAULT 0 NOT NULL,
  "is_lost" INTEGER DEFAULT 0 NOT NULL,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pipelines" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "name" TEXT NOT NULL,
  "is_default" INTEGER DEFAULT 0 NOT NULL,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "products" (
  "id" INTEGER,
  "vendor" TEXT NOT NULL,
  "system" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "sub_category" TEXT NOT NULL,
  "fast_view" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "price_si" REAL DEFAULT 0 NOT NULL,
  "specifications" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "picture_url" TEXT,
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
  "kind" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size_bytes" INTEGER DEFAULT 0 NOT NULL,
  "storage_path" TEXT NOT NULL,
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
  "status" TEXT NOT NULL,
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
  "amount" REAL DEFAULT 0 NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "notes" TEXT,
  "issued_at" TEXT,
  "expected_at" TEXT,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "project_id" INTEGER,
  PRIMARY KEY ("id")
);

-- NOTE: skipped tsvector column(s) on quotations: search_tsv -- needs FTS5 rewrite
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
  "tax_percent" REAL DEFAULT 16 NOT NULL,
  "site_name" TEXT NOT NULL,
  "items_json" TEXT NOT NULL,
  "totals_json" TEXT NOT NULL,
  "config_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "folder_id" INTEGER,
  "deleted_at" TEXT,
  "status" TEXT NOT NULL,
  "parent_ref" TEXT,
  "custom_fields" TEXT NOT NULL,
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
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "storage_locations" (
  "id" INTEGER,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "created_at" TEXT NOT NULL,
  "deleted_at" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "storage_requests" (
  "id" INTEGER,
  "project_id" INTEGER,
  "product_id" INTEGER,
  "location_id" INTEGER,
  "quantity" INTEGER NOT NULL,
  "requested_by" INTEGER,
  "status" TEXT NOT NULL,
  "handled_by" INTEGER,
  "handled_at" TEXT,
  "reason" TEXT,
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "storage_stock" (
  "product_id" INTEGER,
  "location_id" INTEGER,
  "on_hand" INTEGER DEFAULT 0 NOT NULL,
  "reserved" INTEGER DEFAULT 0 NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("product_id", "location_id")
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
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "custom_fields" TEXT NOT NULL,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "team_members" (
  "team_id" INTEGER,
  "user_id" INTEGER,
  "role" TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS "users" (
  "id" INTEGER,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id" INTEGER,
  "workflow_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "message" TEXT,
  "meta_json" TEXT NOT NULL,
  "ran_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflows" (
  "id" INTEGER,
  "owner_id" INTEGER,
  "name" TEXT NOT NULL,
  "trigger_kind" TEXT NOT NULL,
  "trigger_json" TEXT NOT NULL,
  "actions_json" TEXT NOT NULL,
  "enabled" INTEGER DEFAULT 1 NOT NULL,
  "last_run_at" TEXT,
  "deleted_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

COMMIT;
PRAGMA foreign_keys = ON;