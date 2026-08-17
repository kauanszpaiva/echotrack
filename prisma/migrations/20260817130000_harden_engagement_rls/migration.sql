-- Harden the additive engagement/classroom/chat/notification tables introduced
-- by 20260817120000_add_engagement_classroom_chat_notifications.
--
-- This migration is intentionally a forward-fix instead of rewriting the
-- already-merged migration. It is non-destructive: it does not drop, rename, or
-- rewrite data. It preserves EchoTrack's current database boundary, where the
-- browser never talks to Supabase directly and Express/Prisma is the only data
-- path.
--
-- No permissive RLS policies are created here. With RLS enabled and no policies,
-- Supabase Data API roles remain denied by default; the application continues to
-- use its server-side PostgreSQL connection through Prisma.
--
-- Operational rollback: do NOT disable RLS as a routine rollback. If application
-- code must be rolled back, leave these protections in place and forward-fix the
-- application. RLS may only be changed under a separately reviewed security plan.

ALTER TABLE "daily_check_ins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weekly_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "student_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coaching_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "annotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "class_staff_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_channels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_channel_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_dispatches" ENABLE ROW LEVEL SECURITY;
