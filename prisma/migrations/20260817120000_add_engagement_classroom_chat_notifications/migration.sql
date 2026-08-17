-- ═══════════════════════════════════════════════════════════════════════════
-- Student engagement + classroom staffing + chat + notification dispatch
--
-- ADDITIVE ONLY. This migration creates new tables and indexes. It does not
-- ALTER, DROP or RENAME any existing table, column, constraint or index, and
-- it writes no rows. Every existing record is untouched.
--
-- ROLLBACK / RECOVERY
--   Reverse order of creation, dropping only what this file created:
--     DROP TABLE IF EXISTS "notification_dispatches";
--     DROP TABLE IF EXISTS "chat_messages";
--     DROP TABLE IF EXISTS "chat_channel_members";
--     DROP TABLE IF EXISTS "chat_channels";
--     DROP TABLE IF EXISTS "class_staff_memberships";
--     DROP TABLE IF EXISTS "class_change_requests";
--     DROP TABLE IF EXISTS "annotations";
--     DROP TABLE IF EXISTS "coaching_goals";
--     DROP TABLE IF EXISTS "student_templates";
--     DROP TABLE IF EXISTS "weekly_goals";
--     DROP TABLE IF EXISTS "daily_check_ins";
--   Then delete this row from the migration ledger:
--     DELETE FROM "_prisma_migrations"
--      WHERE migration_name = '20260817120000_add_engagement_classroom_chat_notifications';
--   No pre-existing data is at risk, so rollback needs no backup restore.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Student engagement ─────────────────────────────────────────────────────

CREATE TABLE "daily_check_ins" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "mood_emoji" TEXT NOT NULL,
    "mood_label" TEXT,
    "energy_level" INTEGER NOT NULL DEFAULT 5,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_check_ins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "daily_check_ins_student_id_created_at_idx" ON "daily_check_ins"("student_id", "created_at");

CREATE TABLE "weekly_goals" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "cycle_id" TEXT,
    "report_id" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ACADEMIC',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "weekly_goals_student_id_created_at_idx" ON "weekly_goals"("student_id", "created_at");
CREATE INDEX "weekly_goals_cycle_id_idx" ON "weekly_goals"("cycle_id");
CREATE INDEX "weekly_goals_report_id_idx" ON "weekly_goals"("report_id");

CREATE TABLE "student_templates" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "student_templates_student_id_idx" ON "student_templates"("student_id");

CREATE TABLE "coaching_goals" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "coach_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coaching_goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "coaching_goals_student_id_idx" ON "coaching_goals"("student_id");
CREATE INDEX "coaching_goals_coach_id_idx" ON "coaching_goals"("coach_id");

CREATE TABLE "annotations" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "author_id" TEXT,
    "section" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annotations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "annotations_report_id_idx" ON "annotations"("report_id");

CREATE TABLE "class_change_requests" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "class_change_requests_student_id_idx" ON "class_change_requests"("student_id");
CREATE INDEX "class_change_requests_class_id_idx" ON "class_change_requests"("class_id");
CREATE INDEX "class_change_requests_status_idx" ON "class_change_requests"("status");

-- ── Classroom staffing ─────────────────────────────────────────────────────

CREATE TABLE "class_staff_memberships" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "staff_role" TEXT NOT NULL DEFAULT 'PRIMARY_INSTRUCTOR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "class_staff_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "class_staff_memberships_user_id_class_id_staff_role_key" ON "class_staff_memberships"("user_id", "class_id", "staff_role");
CREATE INDEX "class_staff_memberships_class_id_status_idx" ON "class_staff_memberships"("class_id", "status");
CREATE INDEX "class_staff_memberships_user_id_status_idx" ON "class_staff_memberships"("user_id", "status");

-- ── Chat ───────────────────────────────────────────────────────────────────

CREATE TABLE "chat_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_channels_name_key" ON "chat_channels"("name");

CREATE TABLE "chat_channel_members" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "chat_channel_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_channel_members_channel_id_user_id_key" ON "chat_channel_members"("channel_id", "user_id");
CREATE INDEX "chat_channel_members_user_id_idx" ON "chat_channel_members"("user_id");

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reactions" TEXT,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_messages_channel_id_created_at_idx" ON "chat_messages"("channel_id", "created_at");
CREATE INDEX "chat_messages_sender_id_idx" ON "chat_messages"("sender_id");

-- ── Notification dispatch ledger ───────────────────────────────────────────

CREATE TABLE "notification_dispatches" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "recipient_id" TEXT,
    "recipient_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_dispatches_pkey" PRIMARY KEY ("id")
);

-- The idempotency guarantee: one dispatch per (recipient, event, period).
CREATE UNIQUE INDEX "notification_dispatches_dedupe_key_key" ON "notification_dispatches"("dedupe_key");
CREATE INDEX "notification_dispatches_event_type_status_idx" ON "notification_dispatches"("event_type", "status");
CREATE INDEX "notification_dispatches_recipient_id_idx" ON "notification_dispatches"("recipient_id");

-- ── Foreign keys ───────────────────────────────────────────────────────────

ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "weekly_goals" ADD CONSTRAINT "weekly_goals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "weekly_goals" ADD CONSTRAINT "weekly_goals_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "report_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weekly_goals" ADD CONSTRAINT "weekly_goals_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "weekly_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_templates" ADD CONSTRAINT "student_templates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coaching_goals" ADD CONSTRAINT "coaching_goals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coaching_goals" ADD CONSTRAINT "coaching_goals_coach_id_fkey" FOREIGN KEY ("coach_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "annotations" ADD CONSTRAINT "annotations_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "weekly_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "class_change_requests" ADD CONSTRAINT "class_change_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_change_requests" ADD CONSTRAINT "class_change_requests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_change_requests" ADD CONSTRAINT "class_change_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "class_staff_memberships" ADD CONSTRAINT "class_staff_memberships_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "class_staff_memberships" ADD CONSTRAINT "class_staff_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
