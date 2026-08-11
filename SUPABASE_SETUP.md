# EchoTrack — Supabase + Clerk + Vercel Setup

This app uses **Clerk** for authentication and **Supabase Postgres** as its
database (via Prisma). Follow these steps once to go live on Vercel.

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

## 4. Set up Clerk

1. Create an application in the **Clerk Dashboard** (this project is linked to
   `app_3Hma00OGmfOMnFAge9f9gTunNpP`).
2. In **API keys**, copy the **Publishable key** (`pk_...`) and **Secret key**
   (`sk_...`).
3. Enable **Email + password** sign-in. Optionally enable Google / Microsoft /
   Apple under **User & Authentication → Social connections** (the login screen
   shows all three buttons).

The authoritative application role is stored in Clerk **`publicMetadata.role`**
(admin-only, not user-editable). The first authenticated request mirrors the
user into the Postgres `users` table automatically (joined by email).

## 5. Create the first admin

Easiest: run the seed after configuring env vars, which provisions the admin in
Clerk **and** Postgres:

```bash
CLERK_SECRET_KEY='sk_...' DEV_ADMIN_PASSWORD='a-strong-password' npm run db:seed
```

Or create the user manually in the **Clerk Dashboard → Users**, then set
`publicMetadata` to `{"role":"ADMIN"}`.

To migrate an existing set of Postgres users into Clerk in one pass:

```bash
CLERK_SECRET_KEY='sk_...' DATABASE_URL='...' DIRECT_URL='...' \
  npx tsx prisma/backfill-clerk-auth.ts
```

## 6. Configure Vercel environment variables

Vercel dashboard → your project → **Settings → Environment Variables**
(set for **Production** + **Preview**):

| Name                            | Value                                                         |
| ------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                  | pooled URL from step 2 (port 6543, `?pgbouncer=true`)         |
| `DIRECT_URL`                    | direct URL from step 2 (port 5432)                            |
| `CORS_ORIGINS`                  | your domain, e.g. `https://echotrack.vercel.app`              |
| `NODE_ENV`                      | `production`                                                  |
| `VITE_CLERK_PUBLISHABLE_KEY`    | Clerk publishable key (`pk_...`) — public, browser-safe       |
| `CLERK_PUBLISHABLE_KEY`         | same publishable key (server-side)                            |
| `CLERK_SECRET_KEY`              | **secret** Clerk key (`sk_...`). Never expose to the browser. |

> `JWT_SECRET` is no longer required — authentication is handled by Clerk. The
> backend verifies the Clerk session token the browser sends and reads the
> user's role from `publicMetadata` (admin-only, not user-editable).

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
- **Auth:** handled by Clerk. The browser signs in with Clerk and sends the
  session token to the API (`Authorization: Bearer …`); `clerkMiddleware()`
  verifies it and the backend reads the role from `publicMetadata` (authoritative,
  admin-only), mirroring the user into Postgres (joined by email) for relational
  queries. Roles: `DEV`, `ADMIN`, `PROGRAM_MANAGER`, `COACH`, `PSM`, `STUDENT`,
  `INTERN`, `INSTRUCTOR` (default `STUDENT`).

## Local development

```bash
cp .env.example .env.local # fill Clerk keys and database values
npm install
npm run db:deploy
npm run dev               # http://localhost:3000
```
