-- Phase 1 initial schema: Student Organization Fund Tracker
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'deactivated');

-- CreateEnum
CREATE TYPE "ay_status" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "app_role" AS ENUM ('adviser', 'member');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('pending', 'active', 'rejected', 'deactivated');

-- CreateEnum
CREATE TYPE "user_token_type" AS ENUM ('email_verify', 'password_reset');

-- CreateEnum
CREATE TYPE "student_status" AS ENUM ('pending', 'active', 'rejected', 'inactive');

-- CreateEnum
CREATE TYPE "student_source" AS ENUM ('manual', 'csv_import', 'self_enroll', 'promoted');

-- CreateEnum
CREATE TYPE "allocation_mode" AS ENUM ('priority_only', 'staff_chooses', 'hybrid');

-- CreateEnum
CREATE TYPE "approval_rule" AS ENUM ('any_one', 'all_required');

-- CreateEnum
CREATE TYPE "paper_size" AS ENUM ('A4', 'LETTER', 'LEGAL');

-- CreateEnum
CREATE TYPE "charge_status" AS ENUM ('active', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('posted', 'voided');

-- CreateEnum
CREATE TYPE "ledger_entry_type" AS ENUM ('collection', 'usage', 'carry_over', 'adjustment', 'void');

-- CreateEnum
CREATE TYPE "fund_request_status" AS ENUM ('pending', 'approved', 'rejected', 'receipt_submitted', 'revision_requested', 'cleared', 'canceled');

-- CreateEnum
CREATE TYPE "request_decision" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "liquidation_status" AS ENUM ('submitted', 'revision_requested', 'approved');

-- CreateEnum
CREATE TYPE "liquidation_decision" AS ENUM ('approved', 'revision_requested');

-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('queued', 'sending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "last_name" VARCHAR(100) NOT NULL,
    "suffix" VARCHAR(20),
    "contact_no" VARCHAR(30),
    "status" "user_status" NOT NULL DEFAULT 'active',
    "email_verified_at" TIMESTAMPTZ(6),
    "privacy_consent_at" TIMESTAMPTZ(6),
    "privacy_consent_version" VARCHAR(20),
    "totp_secret_enc" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by" UUID,
    "deactivated_by_name" TEXT,
    "deactivation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "user_token_type" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "start_year" SMALLINT NOT NULL,
    "end_year" SMALLINT NOT NULL,
    "label" VARCHAR(9) NOT NULL,
    "status" "ay_status" NOT NULL DEFAULT 'open',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "closed_by_name" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "designations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "can_file_requests" BOOLEAN NOT NULL DEFAULT false,
    "can_collect" BOOLEAN NOT NULL DEFAULT false,
    "is_confidential_exempt" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ay_roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "app_role",
    "designation_id" UUID,
    "status" "membership_status" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decided_by_name" TEXT,
    "decision_note" TEXT,
    "deactivated_at" TIMESTAMPTZ(6),
    "deactivated_by" UUID,
    "deactivated_by_name" TEXT,
    "copied_from_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_ay_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ay_approvers" (
    "academic_year_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "approves_fund_requests" BOOLEAN NOT NULL DEFAULT true,
    "approves_liquidations" BOOLEAN NOT NULL DEFAULT true,
    "added_by" UUID,
    "added_by_name" TEXT,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ay_approvers_pkey" PRIMARY KEY ("academic_year_id","user_id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "storage_driver" VARCHAR(20) NOT NULL DEFAULT 'local',
    "storage_key" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by" UUID,
    "uploaded_by_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ay_settings" (
    "academic_year_id" UUID NOT NULL,
    "school_name" VARCHAR(200) NOT NULL DEFAULT '',
    "school_abbr" VARCHAR(30) NOT NULL DEFAULT '',
    "college_name" VARCHAR(200) NOT NULL DEFAULT '',
    "college_abbr" VARCHAR(30) NOT NULL DEFAULT '',
    "org_name" VARCHAR(200) NOT NULL DEFAULT '',
    "org_abbr" VARCHAR(30) NOT NULL DEFAULT '',
    "program_name" VARCHAR(200),
    "program_abbr" VARCHAR(30),
    "logo_file_id" UUID,
    "year_level_count" SMALLINT NOT NULL DEFAULT 4,
    "allow_partial_payments" BOOLEAN NOT NULL DEFAULT true,
    "allocation_mode" "allocation_mode" NOT NULL DEFAULT 'hybrid',
    "request_approval_rule" "approval_rule" NOT NULL DEFAULT 'any_one',
    "liquidation_approval_rule" "approval_rule" NOT NULL DEFAULT 'any_one',
    "receipt_logo_file_id" UUID,
    "receipt_footer_text" TEXT NOT NULL DEFAULT '',
    "receipt_qr_message" TEXT NOT NULL DEFAULT 'Please check student status using the QR',
    "require_request_attachment" BOOLEAN NOT NULL DEFAULT true,
    "require_liquidation_attachment" BOOLEAN NOT NULL DEFAULT true,
    "public_fields" JSONB NOT NULL DEFAULT '["name","status","breakdown"]',
    "report_header_text" TEXT NOT NULL DEFAULT '',
    "report_prepared_by_name" VARCHAR(150),
    "report_prepared_by_title" VARCHAR(150),
    "report_noted_by_name" VARCHAR(150),
    "report_noted_by_title" VARCHAR(150),
    "report_paper_size" "paper_size" NOT NULL DEFAULT 'A4',
    "email_sender_name" VARCHAR(150),
    "email_sender_address" CITEXT,
    "email_reply_to" CITEXT,
    "email_templates" JSONB NOT NULL DEFAULT '{}',
    "notification_events" JSONB NOT NULL DEFAULT '{}',
    "password_min_length" SMALLINT NOT NULL DEFAULT 10,
    "password_require_upper" BOOLEAN NOT NULL DEFAULT true,
    "password_require_number" BOOLEAN NOT NULL DEFAULT true,
    "password_require_symbol" BOOLEAN NOT NULL DEFAULT false,
    "session_timeout_minutes" INTEGER NOT NULL DEFAULT 60,
    "twofa_mode" VARCHAR(10) NOT NULL DEFAULT 'off',
    "upload_allowed_mime" JSONB NOT NULL DEFAULT '["image/jpeg","image/png","image/webp","application/pdf"]',
    "upload_max_bytes" INTEGER NOT NULL DEFAULT 10485760,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Manila',
    "date_format" VARCHAR(20) NOT NULL DEFAULT 'YYYY-MM-DD',
    "privacy_consent_text" TEXT NOT NULL DEFAULT '',
    "privacy_consent_version" VARCHAR(20) NOT NULL DEFAULT '1',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "updated_by_name" TEXT,

    CONSTRAINT "ay_settings_pkey" PRIMARY KEY ("academic_year_id")
);

-- CreateTable
CREATE TABLE "ay_counters" (
    "academic_year_id" UUID NOT NULL,
    "counter_key" VARCHAR(30) NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ay_counters_pkey" PRIMARY KEY ("academic_year_id","counter_key")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120),
    "expires_at" TIMESTAMPTZ(6),
    "max_uses" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_name" TEXT,

    CONSTRAINT "enrollment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "student_number" VARCHAR(30) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "last_name" VARCHAR(100) NOT NULL,
    "suffix" VARCHAR(20),
    "name_key" VARCHAR(300) NOT NULL,
    "name_key_loose" VARCHAR(300) NOT NULL,
    "program_id" UUID NOT NULL,
    "year_level" SMALLINT NOT NULL,
    "section_id" UUID,
    "email" CITEXT,
    "contact_no" VARCHAR(30),
    "status" "student_status" NOT NULL DEFAULT 'active',
    "source" "student_source" NOT NULL,
    "consent_given_at" TIMESTAMPTZ(6),
    "consent_version" VARCHAR(20),
    "duplicate_override" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_override_by" UUID,
    "duplicate_override_by_name" TEXT,
    "duplicate_override_reason" TEXT,
    "needs_profile_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "profile_confirmed_at" TIMESTAMPTZ(6),
    "profile_confirmed_by" UUID,
    "profile_confirmed_by_name" TEXT,
    "enrollment_link_id" UUID,
    "promoted_from_student_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_by_name" TEXT,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "rejected_by_name" TEXT,
    "rejection_comment" TEXT,
    "created_by" UUID,
    "created_by_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_qr_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoked_by_name" TEXT,
    "revoke_reason" TEXT,

    CONSTRAINT "student_qr_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "notes" TEXT,
    "amount_per_student" BIGINT NOT NULL,
    "is_confidential" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "all_programs" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "copied_from_fund_id" UUID,
    "created_by" UUID,
    "created_by_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_year_levels" (
    "academic_year_id" UUID NOT NULL,
    "fund_id" UUID NOT NULL,
    "year_level" SMALLINT NOT NULL,

    CONSTRAINT "fund_year_levels_pkey" PRIMARY KEY ("fund_id","year_level")
);

-- CreateTable
CREATE TABLE "fund_programs" (
    "academic_year_id" UUID NOT NULL,
    "fund_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,

    CONSTRAINT "fund_programs_pkey" PRIMARY KEY ("fund_id","program_id")
);

-- CreateTable
CREATE TABLE "student_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "fund_id" UUID NOT NULL,
    "amount_due" BIGINT NOT NULL,
    "status" "charge_status" NOT NULL DEFAULT 'active',
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" UUID,
    "cancelled_by_name" TEXT,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "transaction_no" VARCHAR(20) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_before" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "cleared_after" BOOLEAN NOT NULL,
    "student_number_snapshot" VARCHAR(30) NOT NULL,
    "student_name_snapshot" VARCHAR(300) NOT NULL,
    "program_snapshot" VARCHAR(20) NOT NULL,
    "year_level_snapshot" SMALLINT NOT NULL,
    "section_snapshot" VARCHAR(20),
    "processed_by" UUID NOT NULL,
    "processed_by_name" TEXT NOT NULL,
    "processed_by_designation" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qr_token_id" UUID,
    "qr_url" TEXT NOT NULL,
    "notes" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'posted',
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "voided_by_name" TEXT,
    "voided_by_designation" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "fund_name_snapshot" TEXT NOT NULL,
    "charge_balance_after" BIGINT NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "request_no" VARCHAR(20) NOT NULL,
    "fund_id" UUID NOT NULL,
    "fund_name_snapshot" TEXT NOT NULL,
    "requestor_id" UUID NOT NULL,
    "requestor_name" TEXT NOT NULL,
    "requestor_designation" TEXT NOT NULL,
    "amount_requested" BIGINT NOT NULL,
    "purpose" TEXT NOT NULL,
    "use_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "fund_request_status" NOT NULL DEFAULT 'pending',
    "approval_rule" "approval_rule" NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_by_name" TEXT,
    "approved_by_designation" TEXT,
    "rejected_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "rejected_by_name" TEXT,
    "rejection_comment" TEXT,
    "canceled_at" TIMESTAMPTZ(6),
    "canceled_by" UUID,
    "canceled_by_name" TEXT,
    "cancel_reason" TEXT,
    "cleared_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_request_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "fund_request_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "approver_name" TEXT NOT NULL,
    "approver_designation" TEXT,
    "decision" "request_decision" NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_request_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidation_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "fund_request_id" UUID NOT NULL,
    "version" SMALLINT NOT NULL,
    "approved_amount" BIGINT NOT NULL,
    "fund_used" BIGINT NOT NULL,
    "remarks" TEXT,
    "status" "liquidation_status" NOT NULL DEFAULT 'submitted',
    "approval_rule" "approval_rule" NOT NULL,
    "submitted_by" UUID NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "submitted_by_designation" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "over_approved_accepted" BOOLEAN NOT NULL DEFAULT false,
    "over_accepted_by" UUID,
    "over_accepted_by_name" TEXT,
    "revision_message" TEXT,
    "revision_requested_at" TIMESTAMPTZ(6),
    "revision_requested_by" UUID,
    "revision_requested_by_name" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "approved_by_name" TEXT,
    "approved_by_designation" TEXT,

    CONSTRAINT "liquidation_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidation_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "liquidation_receipt_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "approver_name" TEXT NOT NULL,
    "approver_designation" TEXT,
    "decision" "liquidation_decision" NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidation_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "fund_request_id" UUID,
    "liquidation_receipt_id" UUID,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "fund_id" UUID NOT NULL,
    "entry_type" "ledger_entry_type" NOT NULL,
    "amount" BIGINT NOT NULL,
    "label" TEXT NOT NULL,
    "payment_id" UUID,
    "allocation_id" UUID,
    "liquidation_receipt_id" UUID,
    "reverses_entry_id" UUID,
    "source_academic_year_id" UUID,
    "source_fund_id" UUID,
    "created_by" UUID,
    "created_by_name" TEXT NOT NULL,
    "created_by_designation" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link_path" TEXT,
    "entity_type" VARCHAR(60),
    "entity_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID,
    "to_email" CITEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "text_body" TEXT,
    "template_key" VARCHAR(60),
    "entity_type" VARCHAR(60),
    "entity_id" UUID,
    "status" "email_status" NOT NULL DEFAULT 'queued',
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "requested_by" UUID,
    "requested_by_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "academic_year_id" UUID,
    "actor_user_id" UUID,
    "actor_name" TEXT NOT NULL,
    "actor_role" TEXT,
    "actor_designation" TEXT,
    "action" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "request_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ay_copy_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_academic_year_id" UUID NOT NULL,
    "target_academic_year_id" UUID NOT NULL,
    "options" JSONB NOT NULL,
    "result_summary" JSONB NOT NULL,
    "executed_by" UUID NOT NULL,
    "executed_by_name" TEXT NOT NULL,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ay_copy_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_type_idx" ON "user_tokens"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_start_year_key" ON "academic_years"("start_year");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_label_key" ON "academic_years"("label");

-- CreateIndex
CREATE UNIQUE INDEX "designations_academic_year_id_name_key" ON "designations"("academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "designations_id_academic_year_id_key" ON "designations"("id", "academic_year_id");

-- CreateIndex
CREATE INDEX "user_ay_roles_academic_year_id_status_idx" ON "user_ay_roles"("academic_year_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_ay_roles_academic_year_id_user_id_key" ON "user_ay_roles"("academic_year_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_ay_roles_id_academic_year_id_key" ON "user_ay_roles"("id", "academic_year_id");

-- CreateIndex
CREATE INDEX "stored_files_storage_key_idx" ON "stored_files"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_id_academic_year_id_key" ON "stored_files"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_academic_year_id_code_key" ON "programs"("academic_year_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "programs_id_academic_year_id_key" ON "programs"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_academic_year_id_name_key" ON "sections"("academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sections_id_academic_year_id_key" ON "sections"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_links_token_key" ON "enrollment_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_links_id_academic_year_id_key" ON "enrollment_links"("id", "academic_year_id");

-- CreateIndex
CREATE INDEX "students_academic_year_id_name_key_idx" ON "students"("academic_year_id", "name_key");

-- CreateIndex
CREATE INDEX "students_academic_year_id_name_key_loose_idx" ON "students"("academic_year_id", "name_key_loose");

-- CreateIndex
CREATE INDEX "students_academic_year_id_program_id_year_level_section_id_idx" ON "students"("academic_year_id", "program_id", "year_level", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_id_academic_year_id_key" ON "students"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_qr_tokens_token_key" ON "student_qr_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "student_qr_tokens_id_academic_year_id_key" ON "student_qr_tokens"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "funds_academic_year_id_name_key" ON "funds"("academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "funds_academic_year_id_priority_key" ON "funds"("academic_year_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "funds_id_academic_year_id_key" ON "funds"("id", "academic_year_id");

-- CreateIndex
CREATE INDEX "student_charges_fund_id_idx" ON "student_charges"("fund_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_charges_student_id_fund_id_key" ON "student_charges"("student_id", "fund_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_charges_id_academic_year_id_key" ON "student_charges"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_academic_year_id_received_at_idx" ON "payments"("academic_year_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "payments_student_id_idx" ON "payments"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_academic_year_id_transaction_no_key" ON "payments"("academic_year_id", "transaction_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_academic_year_id_key" ON "payments"("id", "academic_year_id");

-- CreateIndex
CREATE INDEX "payment_allocations_charge_id_idx" ON "payment_allocations"("charge_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_charge_id_key" ON "payment_allocations"("payment_id", "charge_id");

-- CreateIndex
CREATE INDEX "fund_requests_academic_year_id_status_idx" ON "fund_requests"("academic_year_id", "status");

-- CreateIndex
CREATE INDEX "fund_requests_academic_year_id_requestor_id_idx" ON "fund_requests"("academic_year_id", "requestor_id");

-- CreateIndex
CREATE INDEX "fund_requests_fund_id_status_idx" ON "fund_requests"("fund_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fund_requests_academic_year_id_request_no_key" ON "fund_requests"("academic_year_id", "request_no");

-- CreateIndex
CREATE UNIQUE INDEX "fund_requests_id_academic_year_id_key" ON "fund_requests"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_request_decisions_fund_request_id_approver_id_key" ON "fund_request_decisions"("fund_request_id", "approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "liquidation_receipts_fund_request_id_version_key" ON "liquidation_receipts"("fund_request_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "liquidation_receipts_id_academic_year_id_key" ON "liquidation_receipts"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "liquidation_decisions_liquidation_receipt_id_approver_id_key" ON "liquidation_decisions"("liquidation_receipt_id", "approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_ledger_allocation_id_key" ON "fund_ledger"("allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_ledger_liquidation_receipt_id_key" ON "fund_ledger"("liquidation_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "fund_ledger_reverses_entry_id_key" ON "fund_ledger"("reverses_entry_id");

-- CreateIndex
CREATE INDEX "fund_ledger_fund_id_created_at_idx" ON "fund_ledger"("fund_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "email_outbox_status_scheduled_at_idx" ON "email_outbox"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "audit_logs_academic_year_id_created_at_idx" ON "audit_logs"("academic_year_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ay_roles" ADD CONSTRAINT "user_ay_roles_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ay_roles" ADD CONSTRAINT "user_ay_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ay_roles" ADD CONSTRAINT "user_ay_roles_designation_id_academic_year_id_fkey" FOREIGN KEY ("designation_id", "academic_year_id") REFERENCES "designations"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ay_roles" ADD CONSTRAINT "user_ay_roles_copied_from_id_fkey" FOREIGN KEY ("copied_from_id") REFERENCES "user_ay_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ay_approvers" ADD CONSTRAINT "ay_approvers_academic_year_id_user_id_fkey" FOREIGN KEY ("academic_year_id", "user_id") REFERENCES "user_ay_roles"("academic_year_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ay_settings" ADD CONSTRAINT "ay_settings_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ay_settings" ADD CONSTRAINT "ay_settings_logo_file_id_academic_year_id_fkey" FOREIGN KEY ("logo_file_id", "academic_year_id") REFERENCES "stored_files"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ay_settings" ADD CONSTRAINT "ay_settings_receipt_logo_file_id_academic_year_id_fkey" FOREIGN KEY ("receipt_logo_file_id", "academic_year_id") REFERENCES "stored_files"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ay_counters" ADD CONSTRAINT "ay_counters_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_links" ADD CONSTRAINT "enrollment_links_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_program_id_academic_year_id_fkey" FOREIGN KEY ("program_id", "academic_year_id") REFERENCES "programs"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_section_id_academic_year_id_fkey" FOREIGN KEY ("section_id", "academic_year_id") REFERENCES "sections"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_enrollment_link_id_academic_year_id_fkey" FOREIGN KEY ("enrollment_link_id", "academic_year_id") REFERENCES "enrollment_links"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_promoted_from_student_id_fkey" FOREIGN KEY ("promoted_from_student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_qr_tokens" ADD CONSTRAINT "student_qr_tokens_student_id_academic_year_id_fkey" FOREIGN KEY ("student_id", "academic_year_id") REFERENCES "students"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funds" ADD CONSTRAINT "funds_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funds" ADD CONSTRAINT "funds_copied_from_fund_id_fkey" FOREIGN KEY ("copied_from_fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_year_levels" ADD CONSTRAINT "fund_year_levels_fund_id_academic_year_id_fkey" FOREIGN KEY ("fund_id", "academic_year_id") REFERENCES "funds"("id", "academic_year_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_programs" ADD CONSTRAINT "fund_programs_fund_id_academic_year_id_fkey" FOREIGN KEY ("fund_id", "academic_year_id") REFERENCES "funds"("id", "academic_year_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_programs" ADD CONSTRAINT "fund_programs_program_id_academic_year_id_fkey" FOREIGN KEY ("program_id", "academic_year_id") REFERENCES "programs"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_charges" ADD CONSTRAINT "student_charges_student_id_academic_year_id_fkey" FOREIGN KEY ("student_id", "academic_year_id") REFERENCES "students"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_charges" ADD CONSTRAINT "student_charges_fund_id_academic_year_id_fkey" FOREIGN KEY ("fund_id", "academic_year_id") REFERENCES "funds"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_academic_year_id_fkey" FOREIGN KEY ("student_id", "academic_year_id") REFERENCES "students"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_qr_token_id_academic_year_id_fkey" FOREIGN KEY ("qr_token_id", "academic_year_id") REFERENCES "student_qr_tokens"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_academic_year_id_fkey" FOREIGN KEY ("payment_id", "academic_year_id") REFERENCES "payments"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_charge_id_academic_year_id_fkey" FOREIGN KEY ("charge_id", "academic_year_id") REFERENCES "student_charges"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_requests" ADD CONSTRAINT "fund_requests_fund_id_academic_year_id_fkey" FOREIGN KEY ("fund_id", "academic_year_id") REFERENCES "funds"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_requests" ADD CONSTRAINT "fund_requests_requestor_id_fkey" FOREIGN KEY ("requestor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_request_decisions" ADD CONSTRAINT "fund_request_decisions_fund_request_id_academic_year_id_fkey" FOREIGN KEY ("fund_request_id", "academic_year_id") REFERENCES "fund_requests"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_request_decisions" ADD CONSTRAINT "fund_request_decisions_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidation_receipts" ADD CONSTRAINT "liquidation_receipts_fund_request_id_academic_year_id_fkey" FOREIGN KEY ("fund_request_id", "academic_year_id") REFERENCES "fund_requests"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidation_receipts" ADD CONSTRAINT "liquidation_receipts_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidation_decisions" ADD CONSTRAINT "liquidation_decisions_liquidation_receipt_id_academic_year_fkey" FOREIGN KEY ("liquidation_receipt_id", "academic_year_id") REFERENCES "liquidation_receipts"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidation_decisions" ADD CONSTRAINT "liquidation_decisions_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_file_id_academic_year_id_fkey" FOREIGN KEY ("file_id", "academic_year_id") REFERENCES "stored_files"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_fund_request_id_academic_year_id_fkey" FOREIGN KEY ("fund_request_id", "academic_year_id") REFERENCES "fund_requests"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_liquidation_receipt_id_academic_year_id_fkey" FOREIGN KEY ("liquidation_receipt_id", "academic_year_id") REFERENCES "liquidation_receipts"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger" ADD CONSTRAINT "fund_ledger_fund_id_academic_year_id_fkey" FOREIGN KEY ("fund_id", "academic_year_id") REFERENCES "funds"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger" ADD CONSTRAINT "fund_ledger_payment_id_academic_year_id_fkey" FOREIGN KEY ("payment_id", "academic_year_id") REFERENCES "payments"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger" ADD CONSTRAINT "fund_ledger_liquidation_receipt_id_academic_year_id_fkey" FOREIGN KEY ("liquidation_receipt_id", "academic_year_id") REFERENCES "liquidation_receipts"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger" ADD CONSTRAINT "fund_ledger_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "payment_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger" ADD CONSTRAINT "fund_ledger_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "fund_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger" ADD CONSTRAINT "fund_ledger_source_academic_year_id_fkey" FOREIGN KEY ("source_academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_ledger" ADD CONSTRAINT "fund_ledger_source_fund_id_fkey" FOREIGN KEY ("source_fund_id") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ay_copy_runs" ADD CONSTRAINT "ay_copy_runs_source_academic_year_id_fkey" FOREIGN KEY ("source_academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ay_copy_runs" ADD CONSTRAINT "ay_copy_runs_target_academic_year_id_fkey" FOREIGN KEY ("target_academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Hand-written section (Prisma cannot express these).
-- Keep in sync with README "Migrations → expected drift".
-- =====================================================================

-- ---------- CHECK constraints ----------
ALTER TABLE academic_years
  ADD CONSTRAINT ck_ay_start_year CHECK (start_year BETWEEN 2000 AND 2100),
  ADD CONSTRAINT ck_ay_end_year   CHECK (end_year = start_year + 1),
  ADD CONSTRAINT ck_ay_label      CHECK (label = start_year::text || '-' || end_year::text);

ALTER TABLE user_ay_roles
  ADD CONSTRAINT ck_membership_role CHECK (
    status IN ('pending', 'rejected') OR role = 'adviser' OR (role = 'member' AND designation_id IS NOT NULL)
  );

ALTER TABLE stored_files ADD CONSTRAINT ck_file_size CHECK (size_bytes > 0);

ALTER TABLE ay_settings
  ADD CONSTRAINT ck_settings_year_levels CHECK (year_level_count BETWEEN 1 AND 10),
  ADD CONSTRAINT ck_settings_pw_len      CHECK (password_min_length BETWEEN 8 AND 128),
  ADD CONSTRAINT ck_settings_timeout     CHECK (session_timeout_minutes BETWEEN 5 AND 1440),
  ADD CONSTRAINT ck_settings_twofa       CHECK (twofa_mode IN ('off', 'optional', 'required')),
  ADD CONSTRAINT ck_settings_upload_max  CHECK (upload_max_bytes BETWEEN 102400 AND 52428800);

ALTER TABLE ay_counters ADD CONSTRAINT ck_counter_nonneg CHECK (last_value >= 0);

ALTER TABLE enrollment_links ADD CONSTRAINT ck_link_max_uses CHECK (max_uses IS NULL OR max_uses > 0);

ALTER TABLE students ADD CONSTRAINT ck_student_year_level CHECK (year_level BETWEEN 1 AND 10);

ALTER TABLE funds ADD CONSTRAINT ck_fund_amount CHECK (amount_per_student >= 0);

ALTER TABLE fund_year_levels ADD CONSTRAINT ck_fund_year_level CHECK (year_level BETWEEN 1 AND 10);

ALTER TABLE student_charges ADD CONSTRAINT ck_charge_amount CHECK (amount_due >= 0);

ALTER TABLE payments
  ADD CONSTRAINT ck_payment_amount CHECK (amount > 0),
  ADD CONSTRAINT ck_payment_void CHECK (
    status = 'posted'
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(trim(coalesce(void_reason, ''))) > 0)
  );

ALTER TABLE payment_allocations
  ADD CONSTRAINT ck_alloc_amount  CHECK (amount > 0),
  ADD CONSTRAINT ck_alloc_balance CHECK (charge_balance_after >= 0);

ALTER TABLE fund_requests ADD CONSTRAINT ck_request_amount CHECK (amount_requested > 0);

ALTER TABLE liquidation_receipts
  ADD CONSTRAINT ck_liq_version   CHECK (version >= 1),
  ADD CONSTRAINT ck_liq_fund_used CHECK (fund_used > 0),
  ADD CONSTRAINT ck_liq_over      CHECK (status <> 'approved' OR fund_used <= approved_amount OR over_approved_accepted);

ALTER TABLE attachments
  ADD CONSTRAINT ck_attachment_owner CHECK (num_nonnulls(fund_request_id, liquidation_receipt_id) = 1);

ALTER TABLE fund_ledger
  ADD CONSTRAINT ck_ledger_nonzero CHECK (amount <> 0),
  ADD CONSTRAINT ck_ledger_shape CHECK (
       (entry_type = 'collection' AND amount > 0 AND allocation_id IS NOT NULL)
    OR (entry_type = 'usage'      AND amount < 0 AND liquidation_receipt_id IS NOT NULL)
    OR (entry_type = 'carry_over' AND amount > 0 AND source_fund_id IS NOT NULL AND source_academic_year_id IS NOT NULL)
    OR (entry_type = 'adjustment')
    OR (entry_type = 'void'       AND reverses_entry_id IS NOT NULL)
  );

ALTER TABLE ay_copy_runs ADD CONSTRAINT ck_copy_distinct CHECK (source_academic_year_id <> target_academic_year_id);

-- ---------- Partial unique indexes ----------
CREATE UNIQUE INDEX ux_ay_single_current ON academic_years ((true)) WHERE is_current;

-- exactly one active adviser per AY (also makes "first signup = adviser" race-safe)
CREATE UNIQUE INDEX ux_one_active_adviser ON user_ay_roles (academic_year_id)
  WHERE role = 'adviser' AND status = 'active';

-- UNIQUE(academic_year_id, student_number), ignoring rejected self-enrollments
CREATE UNIQUE INDEX ux_students_ay_number ON students (academic_year_id, student_number)
  WHERE status <> 'rejected';

CREATE UNIQUE INDEX ux_one_active_qr_per_student ON student_qr_tokens (student_id) WHERE is_active;

CREATE UNIQUE INDEX ux_liq_one_live ON liquidation_receipts (fund_request_id)
  WHERE status IN ('submitted', 'approved');

CREATE UNIQUE INDEX ux_ledger_one_carry_over ON fund_ledger (fund_id, source_fund_id)
  WHERE entry_type = 'carry_over';

-- ---------- Append-only tables ----------
CREATE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END $$;

CREATE TRIGGER trg_ledger_append_only BEFORE UPDATE OR DELETE ON fund_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER trg_alloc_append_only BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER trg_audit_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER trg_frd_append_only BEFORE UPDATE OR DELETE ON fund_request_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER trg_ld_append_only BEFORE UPDATE OR DELETE ON liquidation_decisions
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- ---------- Payments: never deleted; the only allowed change is posted -> voided ----------
CREATE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted; void instead';
  END IF;
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'payment % is already voided', OLD.transaction_no;
  END IF;
  IF NEW.status <> 'voided' THEN
    RAISE EXCEPTION 'payments are not editable; void instead';
  END IF;
  IF ROW(NEW.amount, NEW.student_id, NEW.transaction_no, NEW.received_at, NEW.processed_by, NEW.processed_by_name)
     IS DISTINCT FROM
     ROW(OLD.amount, OLD.student_id, OLD.transaction_no, OLD.received_at, OLD.processed_by, OLD.processed_by_name) THEN
    RAISE EXCEPTION 'payment fields are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_guard BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Payments only for active students whose course/year/section is confirmed
CREATE FUNCTION payments_require_ready_student() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM students
             WHERE id = NEW.student_id AND (status <> 'active' OR needs_profile_confirmation)) THEN
    RAISE EXCEPTION 'Student must be active with a confirmed course/year/section before payment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_ready_student BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_require_ready_student();

-- Allocations must sum exactly to payments.amount (checked at COMMIT)
CREATE FUNCTION check_payment_allocation_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_payment_id uuid;
  v_expected   bigint;
  v_actual     bigint;
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    v_payment_id := NEW.id;
  ELSE
    v_payment_id := NEW.payment_id;
  END IF;
  SELECT amount INTO v_expected FROM payments WHERE id = v_payment_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_actual FROM payment_allocations WHERE payment_id = v_payment_id;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'allocations (%) must equal the amount paid (%) for payment %', v_actual, v_expected, v_payment_id;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_payment_sum_on_payment AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_allocation_sum();
CREATE CONSTRAINT TRIGGER trg_payment_sum_on_alloc AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_allocation_sum();

-- No charge may ever be paid beyond its amount (overpayment is not allowed)
CREATE FUNCTION check_charge_not_overpaid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_due  bigint;
  v_paid bigint;
BEGIN
  SELECT amount_due INTO v_due FROM student_charges WHERE id = NEW.charge_id;
  SELECT COALESCE(SUM(a.amount), 0) INTO v_paid
  FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
  WHERE a.charge_id = NEW.charge_id AND p.status = 'posted';
  IF v_paid > v_due THEN
    RAISE EXCEPTION 'charge % overpaid (% > %)', NEW.charge_id, v_paid, v_due;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_charge_not_overpaid AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_charge_not_overpaid();

-- ---------- Fund amounts lock once collection has started ----------
CREATE FUNCTION funds_lock_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_per_student IS DISTINCT FROM OLD.amount_per_student
     AND EXISTS (SELECT 1 FROM payment_allocations a
                 JOIN student_charges c ON c.id = a.charge_id
                 WHERE c.fund_id = OLD.id) THEN
    RAISE EXCEPTION 'Amount of fund "%" is locked: collection has started', OLD.name;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_funds_lock_amount BEFORE UPDATE OF amount_per_student ON funds
  FOR EACH ROW EXECUTE FUNCTION funds_lock_amount();

CREATE FUNCTION charges_lock_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_due IS DISTINCT FROM OLD.amount_due
     AND EXISTS (SELECT 1 FROM payment_allocations WHERE charge_id = OLD.id) THEN
    RAISE EXCEPTION 'Charge amount is locked: payments exist';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_charges_lock_amount BEFORE UPDATE OF amount_due ON student_charges
  FOR EACH ROW EXECUTE FUNCTION charges_lock_amount();

-- ---------- Derived views (statuses are computed, never stored) ----------
CREATE VIEW v_charge_balances AS
SELECT c.id AS charge_id, c.academic_year_id, c.student_id, c.fund_id,
       f.name AS fund_name, f.priority, f.is_mandatory, f.is_confidential,
       c.amount_due, x.paid AS amount_paid, c.amount_due - x.paid AS balance,
       CASE WHEN x.paid >= c.amount_due THEN 'paid'
            WHEN x.paid > 0             THEN 'partial'
            ELSE 'unpaid' END AS pay_status
FROM student_charges c
JOIN funds f ON f.id = c.fund_id
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(a.amount), 0)::bigint AS paid
  FROM payment_allocations a
  JOIN payments p ON p.id = a.payment_id
  WHERE a.charge_id = c.id AND p.status = 'posted'
) x
WHERE c.status = 'active';

CREATE VIEW v_student_clearance AS
SELECT s.id AS student_id, s.academic_year_id,
       COALESCE(SUM(cb.amount_due), 0)::bigint                              AS total_due,
       COALESCE(SUM(cb.amount_paid), 0)::bigint                             AS total_paid,
       COALESCE(SUM(cb.balance), 0)::bigint                                 AS total_balance,
       COALESCE(SUM(cb.balance) FILTER (WHERE cb.is_mandatory), 0)::bigint  AS mandatory_balance,
       NOT COALESCE(bool_or(cb.is_mandatory AND cb.pay_status <> 'paid'), false) AS is_cleared
FROM students s
LEFT JOIN v_charge_balances cb ON cb.student_id = s.id
WHERE s.status = 'active'
GROUP BY s.id, s.academic_year_id;

CREATE VIEW v_fund_balances AS
SELECT f.id AS fund_id, f.academic_year_id, f.name, f.is_confidential,
       COALESCE(l.balance, 0)::bigint                              AS balance,
       COALESCE(r.committed, 0)::bigint                            AS committed,
       (COALESCE(l.balance, 0) - COALESCE(r.committed, 0))::bigint AS available
FROM funds f
LEFT JOIN (SELECT fund_id, SUM(amount) AS balance FROM fund_ledger GROUP BY fund_id) l
       ON l.fund_id = f.id
LEFT JOIN (SELECT fund_id, SUM(amount_requested) AS committed
           FROM fund_requests
           WHERE status IN ('approved', 'receipt_submitted', 'revision_requested')
           GROUP BY fund_id) r
       ON r.fund_id = f.id;
