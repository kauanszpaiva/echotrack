CREATE TABLE "conduct_entries" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL,
    "follow_up" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conduct_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "conduct_entries_student_id_created_at_idx" ON "conduct_entries"("student_id", "created_at");
CREATE INDEX "conduct_entries_status_idx" ON "conduct_entries"("status");
ALTER TABLE "conduct_entries" ADD CONSTRAINT "conduct_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conduct_entries" ADD CONSTRAINT "conduct_entries_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conduct_entries" ADD CONSTRAINT "conduct_entries_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
