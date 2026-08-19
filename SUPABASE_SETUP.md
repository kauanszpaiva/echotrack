# EchoTrack — Supabase + Clerk + Vercel Setup

This app uses **Clerk** for authentication and **Supabase Postgres** as its
database (via Prisma). Follow these steps once to go live on Vercel.

Request flow:

```
Browser → Clerk (sign-in) → Clerk session token → Express API (/api)
        → verify token + resolve role → Prisma → Supabase Postgres
```

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

Migrations are an **explicit, manual step** — they are *not* part of the Vercel
build (see “Deploy” below for why). Run them from your machine (or a CI job)
with the two URLs exported:

```bash
export DATABASE_URL="postgresql://postgres.[REF]:[PASSWORD]@...pooler.supabase.com:6543/postgres?pgbouncer=true"
export DIRECT_URL="postgresql://postgres.[REF]:[PASSWORD]@...pooler.supabase.com:5432/postgres"

npm install
npm run db:deploy   # prisma migrate deploy — applies prisma/migrations
```

Order of operations for a schema change: **apply the migration first, then
deploy the code.** All migrations in this repo are additive, so the currently
deployed code keeps working against the new schema during the gap.

## 4. Set up Clerk

1. Create an application in the **Clerk Dashboard**.
2. In **API keys**, copy the **Publishable key** (`pk_…`) and **Secret key** (`sk_…`).
3. Enable **Email + password** sign-in.
4. *Optional:* enable social connections under **User & Authentication → Social
   connections**. Then list the enabled ones in `VITE_OAUTH_PROVIDERS`
   (e.g. `google,microsoft`) so the login screen only shows buttons that work.
   The default is `google` alone.
5. Under **Paths / Redirects**, allow your production domain and
   `https://<domain>/sso-callback` as a redirect URL.

The authoritative application role lives in Clerk **`publicMetadata.role`**
(admin-only, not user-editable). Valid values: `DEV`, `ADMIN`,
`PROGRAM_MANAGER`, `COACH`, `PSM`, `INSTRUCTOR`, `STUDENT`, `INTERN`. Anything
missing or unrecognised resolves to `STUDENT` — the least-privileged role.

## 5. Create the first admin

Easiest: run the seed after configuring env vars, which provisions the admin in
Clerk **and** Postgres:

```bash
CLERK_SECRET_KEY='sk_…' DEV_ADMIN_PASSWORD='a-strong-password' npm run db:seed
```

Or create the user manually in the **Clerk Dashboard → Users**, then set
`publicMetadata` to `{"role":"ADMIN"}`.

To also seed one login per remaining role (Dev, Program Manager, Coach, PSM,
Instructor, Student, Intern) — useful for exercising every dashboard locally —
add `DEV_SEED_PASSWORD`; the whole set shares that password. Leave it unset in
production.

```bash
CLERK_SECRET_KEY='sk_…' DEV_ADMIN_PASSWORD='a-strong-password' \
  DEV_SEED_PASSWORD='a-strong-password' npm run db:seed
```

To link an existing set of Postgres users to Clerk identities in one pass
(idempotent, non-destructive; dry run by default):

```bash
CLERK_SECRET_KEY='sk_…' DATABASE_URL='…' DIRECT_URL='…' \
  npx tsx prisma/backfill-clerk-auth.ts           # prints the plan
CLERK_SECRET_KEY='sk_…' DATABASE_URL='…' DIRECT_URL='…' \
  npx tsx prisma/backfill-clerk-auth.ts --apply   # performs it
```

Backfilled users have a random password that is never printed or stored — they
set their own through Clerk's “Forgot password”.

## 6. Configure Vercel environment variables

Vercel dashboard → your project → **Settings → Environment Variables**
(set for **Production** + **Preview**):

| Name                         | Scope   | Value                                                     |
| ---------------------------- | ------- | --------------------------------------------------------- |
| `DATABASE_URL`               | server  | pooled URL from step 2 (port 6543, `?pgbouncer=true`)      |
| `DIRECT_URL`                 | server  | direct URL from step 2 (port 5432)                         |
| `CLERK_SECRET_KEY`           | server  | **secret** Clerk key (`sk_…`) — never exposed to the browser |
| `CLERK_PUBLISHABLE_KEY`      | server  | Clerk publishable key (`pk_…`)                             |
| `CORS_ORIGINS`               | server  | your domain(s), e.g. `https://echotrack.vercel.app`        |
| `NODE_ENV`                   | server  | `production`                                               |
| `VITE_CLERK_PUBLISHABLE_KEY` | browser | Clerk publishable key (`pk_…`) — public by design           |
| `VITE_OAUTH_PROVIDERS`       | browser | optional, e.g. `google` (default when unset)               |

Only `VITE_`-prefixed values are compiled into the browser bundle. Never give a
secret that prefix.

`JWT_SECRET`, `COOKIE_SAMESITE` and the old `DEV_ADMIN_EMAILS` are no longer
read by any code — remove them from Vercel if they are still set.

## 7. Deploy

Push to the connected branch (or `vercel --prod`). The build runs:

```
prisma generate && vite build
```

**Migrations are intentionally not in the build command.** Vercel builds
previews and production concurrently against the same Supabase database, so
`prisma migrate deploy` at build time would race between parallel deployments
and would let a preview build alter the production schema. Run `npm run db:deploy`
yourself (step 3) before deploying code that needs a new column.

Vercel serves the SPA from `dist/` and routes `/api/*` to the Express app
(`api/index.ts` → `server/app.ts`).

---

## Architecture recap

- **Frontend:** React + Vite SPA (`dist/`), served by Vercel. Holds no secrets —
  only the Clerk publishable key.
- **API:** single Express app (`server/app.ts`) exported as a Vercel serverless
  function (`api/index.ts`); all `/api/*` requests are rewritten to it.
- **DB:** Supabase Postgres via Prisma. Runtime uses the pooled `DATABASE_URL`;
  migrations use `DIRECT_URL`. A single cached `PrismaClient` (`server/prisma.ts`)
  avoids exhausting connections on serverless.
- **Auth:** Clerk. The browser signs in with Clerk and sends the session token
  (`Authorization: Bearer …`); `clerkMiddleware()` verifies it and
  `server/auth.ts` reads the role from `publicMetadata`.
- **Authorization:** `roleMiddleware` on every protected endpoint. The SPA's
  route guards (`src/components/RouteGuards.tsx`) are UX only — the API never
  trusts a role sent by the client.

### User identity: Clerk ↔ Postgres

Clerk owns identity; Postgres keeps a mirror row so application data can have
foreign keys. The two are linked by `users.clerk_user_id`:

1. Look the user up by `clerk_user_id` (survives an email change in Clerk).
2. Otherwise match on email and **claim** that row — it keeps its existing
   primary key, so all its relations stay intact — stamping `clerk_user_id`.
3. Otherwise create a mirror row keyed by the Clerk user id.

A mirror row already linked to a *different* Clerk identity is never re-pointed:
the request fails with `409 IDENTITY_CONFLICT` for an admin to resolve.

`users.password` is a **deprecated** leftover column. Nothing reads or writes it
— Clerk owns passwords. It is left in place (empty string default) so no
destructive migration is needed; drop it in a dedicated migration once every
environment is confirmed clean.

### Row Level Security (RLS)

RLS is **enabled with no policies** on every table, and that is the intended
configuration. Nothing outside the server ever touches the database:

- The browser has no Supabase client, no `anon` key and no `service_role` key.
- All access goes through Prisma from the Express API, using the server-side
  Postgres connection string, whose role owns the tables and therefore bypasses
  RLS.
- Authorization happens in the API (`authMiddleware` + `roleMiddleware`), not in
  the database.

“RLS enabled, 0 policies” therefore means *deny all* for the Supabase
`anon`/`authenticated` API roles, which is exactly what we want. **Do not add
permissive policies to silence the Supabase advisor warnings** — that would open
data to the public REST endpoint that is currently closed. If direct
client-to-Supabase access is ever introduced, real policies must be designed
first.

## Local development

```bash
cp .env.example .env.local # fill Clerk keys and database values
npm install
npm run db:deploy
npm run dev                # http://localhost:3000
```

Checks:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest — auth, authorization and CORS behaviour
```
