# EchoTrack — Supabase + Vercel Setup

This app uses **Supabase Postgres** as its database (via Prisma) with a
self-issued **JWT + bcrypt** login (email/password) against the `users` table.
It does **not** use Supabase Auth. Follow these steps once to go live on Vercel.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Pick a name (e.g. `echotrack`), a strong **database password** (save it), and a region close to your users.
3. Wait for provisioning to finish.

## 2. Get the connection strings

In the project: **Connect** (top bar) → **ORMs** → **Prisma**. Copy the two URLs:

- `DATABASE_URL` — pooled, port **6543**, ends with `?pgbouncer=true`
- `DIRECT_URL` — direct, port **5432**

Replace `[YOUR-PASSWORD]` in both with the database password from step 1.

## 3. Run the database migration

From your machine (one time), with the two URLs exported:

```bash
export DATABASE_URL="postgresql://postgres.[REF]:[PASSWORD]@...pooler.supabase.com:6543/postgres?pgbouncer=true"
export DIRECT_URL="postgresql://postgres.[REF]:[PASSWORD]@...pooler.supabase.com:5432/postgres"

npm install
npm run db:deploy   # applies prisma/migrations to Supabase
```

> On Vercel this also runs automatically at build time (see `vercel.json` →
> `prisma migrate deploy`), so this local step is optional but good for a first check.

## 4. Create the first admin

The app has no public admin signup. The admin password is never hardcoded —
you provide it via env and run the seed once.

**Option A — seed script (one time):**

```bash
export DEV_ADMIN_EMAIL="you@kspdominion.group"
export DEV_ADMIN_PASSWORD="a-strong-password"
npm run db:seed
```

**Option B — Supabase SQL editor:** insert a row into `users` with a bcrypt
hash for the password (`role = 'ADMIN'`, `account_status = 'ACTIVE'`,
`is_active = true`).

> The seed is **not** part of the Vercel build — run it manually against your
> database whenever you need to create or reset the admin login.

## 5. Configure Vercel environment variables

Vercel dashboard → your project → **Settings → Environment Variables**
(set for **Production** + **Preview**):

| Name           | Value                                                   |
| -------------- | ------------------------------------------------------- |
| `DATABASE_URL` | pooled URL from step 2 (port 6543, `?pgbouncer=true`)   |
| `DIRECT_URL`   | direct URL from step 2 (port 5432)                      |
| `JWT_SECRET`   | `openssl rand -hex 32`                                  |
| `CORS_ORIGINS` | your domain, e.g. `https://echotrack.vercel.app`        |
| `NODE_ENV`     | `production`                                            |

## 6. Deploy

Push to the connected branch (or `vercel --prod`). The build runs:

```
prisma generate && prisma migrate deploy && vite build
```

and serves the SPA from `dist/` with the API at `/api/*` (see `vercel.json`).

---

## Architecture recap

- **Frontend:** React + Vite SPA (`dist/`), served by Vercel.
- **API:** single Express app (`server/app.ts`) exported as a Vercel serverless
  function (`api/index.ts`); all `/api/*` requests are rewritten to it.
- **DB:** Supabase Postgres via Prisma. Runtime uses the pooled `DATABASE_URL`;
  migrations use `DIRECT_URL`. A single cached `PrismaClient` (`server/prisma.ts`)
  avoids exhausting connections on serverless.
- **Auth:** JWT in an httpOnly cookie; bcrypt password hashes; role-based access
  (`ADMIN` → `PROGRAM_MANAGER` → `COACH` / `INSTRUCTOR` → `STUDENT`), enforced
  server-side (`roleMiddleware`) and client-side (`ProtectedRoute`).

## Local development

```bash
cp .env.example .env      # fill DATABASE_URL, DIRECT_URL, JWT_SECRET
npm install
npm run db:deploy
npm run dev               # http://localhost:3000
```
