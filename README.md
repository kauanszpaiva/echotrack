# KSP Dominion Group / EchoTrack Weekly Report System

A role-based weekly report system for KSP Dominion Group and EchoTrack. 
Supports students submitting weekly reports, and Admin, Program Managers, Coaches, and Instructors reviewing, tracking, and engaging with those reports.

## Prerequisites
- Node.js (v18+)
- A Supabase Postgres database (see `SUPABASE_SETUP.md`)

## Setup
1. Copy the example environment file:
   `cp .env.example .env.local`
2. Fill `.env.local` with the Supabase browser URL/anon key, database URLs, and a secure `JWT_SECRET`.
3. Install dependencies:
   `npm install`
4. Run migrations against your database:
   `npm run db:deploy`
5. Create the first admin (works in any environment, idempotent):
   `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=a-strong-password npm run db:bootstrap-admin`

## Authentication
Accounts live in the `users` table and sign-in issues a server-signed session
cookie that every `/api/*` route checks. Supabase Auth is used only to broker
Google / Microsoft / Apple identities into that session, so a user created in the
Supabase dashboard cannot sign in — see `SUPABASE_SETUP.md`.

## Deploy (Vercel + Supabase)
See **`SUPABASE_SETUP.md`** for the full step-by-step (connection strings, env vars, social login).

## Running Locally
Start both the Vite frontend and Express backend:
`npm run dev`

## Roles
- **Admin**: Full access.
- **Program Manager**: Views their assigned students, coaches, and alerts.
- **Coach**: Tracks individual student progress and flags alerts.
- **Instructor**: Views class feedback and performance metrics.
- **Student**: Submits weekly reports and views class tracking.
