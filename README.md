# KSP Dominion Group / EchoTrack Weekly Report System

A role-based weekly report system for KSP Dominion Group and EchoTrack. 
Supports students submitting weekly reports, and Admin, Program Managers, Coaches, and Instructors reviewing, tracking, and engaging with those reports.

Authentication is handled by **Clerk**; **Supabase Postgres** (via Prisma) is the application database.

## Prerequisites
- Node.js (v18+)
- A Supabase Postgres database (see `SUPABASE_SETUP.md`)
- A Clerk application (get API keys from the Clerk Dashboard)

## Setup
1. Copy the example environment file:
   `cp .env.example .env.local`
2. Fill `.env.local` with the Clerk keys (`VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) and the Supabase database URLs (`DATABASE_URL`, `DIRECT_URL`).
3. Install dependencies:
   `npm install`
4. Run migrations against your database:
   `npm run db:deploy`
   *(Optional)* Seed a local admin (creates it in Clerk + Postgres):
   `CLERK_SECRET_KEY=sk_... DEV_ADMIN_PASSWORD=strong-pass NODE_ENV=development npm run db:seed`

## Checks
```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest — authentication, authorization and CORS behaviour
npm run build       # production build
```

## Deploy (Vercel + Supabase + Clerk)
See **`SUPABASE_SETUP.md`** for the full step-by-step (connection strings, env vars, Clerk auth).

## Running Locally
Start both the Vite frontend and Express backend:
`npm run dev`

## Roles
The role lives in Clerk `publicMetadata.role` (admin-only, not user-editable) and
is re-resolved from the verified Clerk user on every API request — the client
never gets to declare its own role.

| Role | Access |
| --- | --- |
| **Dev** | Everything Admin has, plus `/dev`. |
| **Admin** | Full access to the admin area, settings, cycles, audit, conduct review. |
| **Program Manager** | Their own students, coaches and alerts; the shared admin screens (users, reports, questions, analytics), scoped server-side to their people. |
| **Coach** / **PSM** | Their assigned students' progress and alerts. |
| **Instructor** | Their own classes, class feedback, and conduct entries for their students. |
| **Student** / **Intern** | Their own weekly reports and class tracking. |

Route guards in the SPA mirror this table, but they are UX only: every endpoint
re-checks the role server-side (`server/auth.ts`).
