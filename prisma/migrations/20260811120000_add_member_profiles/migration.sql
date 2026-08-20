-- Member profiles: LinkedIn-style professional profile for each EchoTrack member.
-- Cohort scoping is read through student_profiles.community_id, so nothing here
-- duplicates community membership.

CREATE TABLE "member_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "headline" TEXT,
    "about" TEXT,
    "location" TEXT,
    "linkedin_url" TEXT,
    "website_url" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "member_profiles_user_id_key" ON "member_profiles"("user_id");
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "work_experiences" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "employment_type" TEXT,
    "location" TEXT,
    "location_type" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_experiences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "work_experiences_profile_id_start_date_idx" ON "work_experiences"("profile_id", "start_date");
ALTER TABLE "work_experiences" ADD CONSTRAINT "work_experiences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "education_entries" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "degree" TEXT,
    "field_of_study" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "education_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "education_entries_profile_id_start_date_idx" ON "education_entries"("profile_id", "start_date");
ALTER TABLE "education_entries" ADD CONSTRAINT "education_entries_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "certifications" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issue_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "credential_id" TEXT,
    "credential_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "certifications_profile_id_issue_date_idx" ON "certifications"("profile_id", "issue_date");
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "profile_skills" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_skills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "profile_skills_profile_id_name_key" ON "profile_skills"("profile_id", "name");
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "member_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
