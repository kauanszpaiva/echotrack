# EchoTrack — Supabase + Vercel Setup

This app uses **Supabase Postgres** as its database (via Prisma). Follow these
steps once to go live on Vercel.

## How authentication works (read this first)

EchoTrack accounts live in the **`users` table** of the application database.
Signing in issues a server-signed session cookie, and every `/api/*` route
authorizes from that cookie (`server/auth.ts`). Roles come from the `role`
column, not from token metadata.

**Supabase Auth is only a social identity broker.** Google / Microsoft / Apple
sign-in returns a Supabase token, which the browser immediately exchanges for an
EchoTrack session at `POST /api/auth/supabase`; the server accepts it only if a
`users` row already exists with that email. Creating a user in
**Authentication → Users** does *not* create an EchoTrack account, and such a
user cannot sign in with a password.

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

Every account-creating API route already requires an admin session, so the first
admin has to be created directly against the database. Run this once, with the
same `DATABASE_URL` / `DIRECT_URL` exported as in step 3:

```bash
ADMIN_EMAIL="kauan@kspdominion.group" \
ADMIN_NAME="Kauan Paiva" \
ADMIN_PASSWORD="a-strong-password-you-choose" \
npm run db:bootstrap-admin
```

The command is idempotent: run it again to reset that admin's password or to
reactivate the account. It writes an `ADMIN` / `ACTIVE` row to the `users` table
— the store the login screen authenticates against. Do **not** create the admin
in Supabase **Authentication → Users**; that is a separate user store and the app
cannot sign in from it.

## 5. Configure Vercel environment variables

Vercel dashboard → your project → **Settings → Environment Variables**
(set for **Production** + **Preview**):

| Name                            | Value                                                         |
| ------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                  | pooled URL from step 2 (port 6543, `?pgbouncer=true`)         |
| `DIRECT_URL`                    | direct URL from step 2 (port 5432)                            |
| `JWT_SECRET`                    | `openssl rand -hex 32`                                        |
| `CORS_ORIGINS`                  | your domain, e.g. `https://echotrack.vercel.app`              |
| `NODE_ENV`                      | `production`                                                  |
| `VITE_SUPABASE_URL`             | project URL from Supabase Project Settings → API (browser)     |
| `VITE_SUPABASE_ANON_KEY`        | anon/publishable key from Supabase Project Settings → API      |
| `SUPABASE_URL`                  | same project URL — used by the API to verify social tokens     |
| `SUPABASE_ANON_KEY`             | same anon key — used by the API to verify social tokens        |

The two `SUPABASE_*` variables are only needed for social sign-in; the API falls
back to the `VITE_` values if they are not set. Email/password login needs
neither — if both pairs are missing the app still runs and only the social
buttons are disabled.

## 6. Supabase OAuth (optional — Google / Microsoft / Apple)

Skip if you only use email/password.

Enable each provider in **Supabase Dashboard → Authentication → Providers** and
add the app's `/dashboard-redirect` URL to the allowed redirect URLs.

Social sign-in only *matches* an existing EchoTrack account by email — it never
creates one. If the provider email has no `users` row, the app sends the person
to the signup form instead of signing them in.

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
- **Auth:** accounts in the `users` table; a server-signed JWT session cookie
  (`JWT_SECRET`) checked by `authMiddleware` on every protected route. Roles come
  from the `role` column. Supabase Auth (and the legacy Firebase endpoint) only
  broker social identities into that session.

## Local development

```bash
cp .env.example .env.local # fill Supabase client and database values
npm install
npm run db:deploy
ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a-strong-local-password" \
  npm run db:bootstrap-admin
npm run dev               # http://localhost:3000
```

## Troubleshooting: "Invalid email or password"

1. Confirm the account exists and is active:
   `select email, role, account_status, is_active from users;`
2. No rows, or no `users` table at all? The migrations were never applied to this
   database — run step 3, then step 4.
3. The row exists but the password is unknown: re-run `npm run db:bootstrap-admin`
   (admins) or resend the invite (everyone else).
4. `Account is not active`: `account_status` is `INVITED` or `DEACTIVATED`, so the
   person needs their setup link or an admin reactivation.
