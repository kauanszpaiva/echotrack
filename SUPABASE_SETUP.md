# EchoTrack — Supabase + Vercel Setup

This app uses **Supabase Auth** in the browser and **Supabase Postgres** as its
database (via Prisma). Follow these steps once to go live on Vercel.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Pick a name (e.g. `echotrack`), a strong **database password** (save it), and a region close to your users.
3. Wait for provisioning to finish.

## 2. Get the connection strings

In **Project Settings → API**, copy the project URL and anon/publishable key to
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. These values are designed for
browser use; authorization must be enforced with Row Level Security. Never use
the service-role key in a `VITE_` variable.

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

Easiest: run the seed after configuring env vars, which provisions the admin in
Supabase Auth **and** Postgres:

```bash
DEV_ADMIN_PASSWORD='a-strong-password' npm run db:seed
```

Or create the user manually in **Authentication → Users**, then set the role in
**`app_metadata`** (`{"role":"ADMIN"}`) — NOT `user_metadata`, which the user can
edit. The backend only trusts `app_metadata`. The first authenticated request
mirrors the user into the Postgres `users` table automatically.

## 5. Configure Vercel environment variables

Vercel dashboard → your project → **Settings → Environment Variables**
(set for **Production** + **Preview**):

| Name                            | Value                                                         |
| ------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                  | pooled URL from step 2 (port 6543, `?pgbouncer=true`)         |
| `DIRECT_URL`                    | direct URL from step 2 (port 5432)                            |
| `CORS_ORIGINS`                  | your domain, e.g. `https://echotrack.vercel.app`              |
| `NODE_ENV`                      | `production`                                                  |
| `VITE_SUPABASE_URL`             | project URL from Supabase Project Settings → API              |
| `VITE_SUPABASE_ANON_KEY`        | anon/publishable key from Supabase Project Settings → API     |
| `SUPABASE_URL`                  | same project URL (server-side; used to validate access tokens)|
| `SUPABASE_SERVICE_ROLE_KEY`     | **secret** service-role key (Project Settings → API). Never expose to the browser. |

> `JWT_SECRET` is no longer required — authentication is unified on Supabase Auth.
> The backend validates the Supabase access token the browser sends and reads the
> user's role from `app_metadata` (admin-only, not user-editable).

## 6. Supabase OAuth (optional — Google / Microsoft / Apple)

Skip if you only use email/password.

Enable each provider in **Supabase Dashboard → Authentication → Providers** and
add the app's `/dashboard-redirect` URL to the allowed redirect URLs.

## 7. Deploy

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
- **Auth:** unified on Supabase Auth. The browser signs in with Supabase and
  sends the access token to the API (`Authorization: Bearer …`); the backend
  validates it and reads the role from `app_metadata` (authoritative, admin-only),
  mirroring the user into Postgres (joined by email) for relational queries.
  Roles: `DEV`, `ADMIN`, `PROGRAM_MANAGER`, `COACH`, `PSM`, `STUDENT`, `INTERN`,
  `INSTRUCTOR` (default `STUDENT`).

## Local development

```bash
cp .env.example .env.local # fill Supabase client and database values
npm install
npm run db:deploy
npm run dev               # http://localhost:3000
```
