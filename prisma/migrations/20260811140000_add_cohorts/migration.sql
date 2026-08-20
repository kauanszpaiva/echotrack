-- Cohorts: one intake per program cycle (~2x/year), covering the whole site
-- across all pathways. A cohort is divided into two learning communities, each
-- of 40-60 students with a dedicated Program Manager and coaches.
--
-- `communities` already models the learning community; this only adds the
-- cohort it belongs to. The column is nullable so existing learning communities
-- keep working until they are assigned to a cohort.

CREATE TABLE "cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "communities" ADD COLUMN "cohort_id" TEXT;
CREATE INDEX "communities_cohort_id_idx" ON "communities"("cohort_id");
ALTER TABLE "communities" ADD CONSTRAINT "communities_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
