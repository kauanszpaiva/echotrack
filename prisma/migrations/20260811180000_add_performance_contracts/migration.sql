-- Performance Contracts, point standing, and EPIC plans.
--
-- Points are a professional standing "bank account": the contract opens with a
-- pool (200 points on most tracks, 150 on CX), weeks that meet expectations add
-- to it, and APPROVED conduct infractions deduct from it. The balance itself is
-- always derived from those inputs rather than stored, so it cannot drift from
-- the conduct record behind it.

CREATE TABLE "performance_contracts" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "weeks_met" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "signed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "performance_contracts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_contracts_student_id_key" ON "performance_contracts"("student_id");
ALTER TABLE "performance_contracts" ADD CONSTRAINT "performance_contracts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "epic_plans" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "opened_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "expectations" TEXT NOT NULL,
    "balance_at_open" INTEGER,
    "review_date" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "outcome_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "epic_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "epic_plans_student_id_status_idx" ON "epic_plans"("student_id", "status");
CREATE INDEX "epic_plans_status_idx" ON "epic_plans"("status");
ALTER TABLE "epic_plans" ADD CONSTRAINT "epic_plans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "epic_plans" ADD CONSTRAINT "epic_plans_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "epic_plans" ADD CONSTRAINT "epic_plans_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Program-wide thresholds. These defaults are placeholders: set them to the
-- site's actual policy before relying on stipend or EPIC signals.
ALTER TABLE "app_settings" ADD COLUMN "stipend_point_threshold" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "app_settings" ADD COLUMN "epic_point_threshold" INTEGER NOT NULL DEFAULT 120;
