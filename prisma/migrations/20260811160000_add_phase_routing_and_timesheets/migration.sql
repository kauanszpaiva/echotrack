-- Phase-aware reporting.
--
-- Phase 1 (Learning & Development) is instruction-based: weekly status reports
-- go to the student's Professional Skills Coach. Phase 2 (Corporate Internship)
-- routes weekly status reports AND timesheets to the student's Placement
-- Success Manager instead. Coaches keep contact in both phases; only the
-- reporting line moves.

-- Students gain a PSM alongside their coach.
ALTER TABLE "student_profiles" ADD COLUMN "psm_id" TEXT;
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_psm_id_fkey" FOREIGN KEY ("psm_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reports record the phase they were filed under and who received them, so the
-- routing stays auditable after the student moves into the next phase.
ALTER TABLE "weekly_reports" ADD COLUMN "phase" TEXT;
ALTER TABLE "weekly_reports" ADD COLUMN "recipient_id" TEXT;
ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 2 timesheets.
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "total_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3),
    "recipient_id" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "timesheets_student_id_cycle_id_key" ON "timesheets"("student_id", "cycle_id");
CREATE INDEX "timesheets_recipient_id_status_idx" ON "timesheets"("recipient_id", "status");
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "report_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "timesheet_entries" (
    "id" TEXT NOT NULL,
    "timesheet_id" TEXT NOT NULL,
    "work_date" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "timesheet_entries_timesheet_id_work_date_idx" ON "timesheet_entries"("timesheet_id", "work_date");
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
