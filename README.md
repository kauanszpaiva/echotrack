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

## Deploy (Vercel + Supabase + Clerk)
See **`SUPABASE_SETUP.md`** for the full step-by-step (connection strings, env vars, Clerk auth).

## Running Locally
Start both the Vite frontend and Express backend:
`npm run dev`

## Roles
- **Admin**: Full access.
- **Program Manager**: Views their assigned students, coaches, and alerts.
- **Coach**: Tracks individual student progress and flags alerts.
- **Instructor**: Views class feedback and performance metrics.
- **Student**: Submits weekly reports and views class tracking.
