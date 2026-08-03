import { createClient, type SupabaseClient, type User as SupabaseUser } from "@supabase/supabase-js";

// Server-side Supabase client using the SERVICE ROLE key. This is the trusted
// backend identity: it validates access tokens and provisions/administers users.
// NEVER expose the service-role key to the browser (no VITE_ prefix).

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cached: SupabaseClient | null = null;

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set both server-side env vars to enable Supabase authentication."
    );
  }
  if (!cached) {
    cached = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Validate a Supabase access token and return the Supabase user, or null. */
export async function getUserFromToken(token: string): Promise<SupabaseUser | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/** The authoritative role for a Supabase user: app_metadata first (admin-only,
 * not user-editable), then user_metadata, else STUDENT. */
export function roleFromSupabaseUser(user: SupabaseUser): string {
  const appRole = (user.app_metadata as any)?.role;
  const metaRole = (user.user_metadata as any)?.role;
  return appRole || metaRole || "STUDENT";
}

export function nameFromSupabaseUser(user: SupabaseUser): string {
  const meta = (user.user_metadata as any) || {};
  return meta.full_name || meta.name || user.email?.split("@")[0] || "User";
}

/**
 * Create (or reuse) a Supabase Auth user with a role stored in app_metadata so
 * it is authoritative and cannot be self-edited by the user. Idempotent on email.
 * Returns the Supabase user id.
 */
export async function provisionSupabaseAuthUser(params: {
  email: string;
  password: string;
  name: string;
  role: string;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const { email, password, name, role } = params;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: name },
  });

  if (error) {
    // If the user already exists in Supabase, make sure the role is in sync.
    if (/already/i.test(error.message)) {
      const existing = await findSupabaseUserByEmail(email);
      if (existing) {
        await admin.auth.admin.updateUserById(existing.id, {
          app_metadata: { role },
        });
        return existing.id;
      }
    }
    throw error;
  }

  return data.user!.id;
}

/** Update a Supabase user's authoritative role in app_metadata. */
export async function setSupabaseUserRole(userId: string, role: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin.auth.admin.updateUserById(userId, { app_metadata: { role } });
}

async function findSupabaseUserByEmail(email: string): Promise<SupabaseUser | null> {
  const admin = getSupabaseAdmin();
  // listUsers is paginated; scan a bounded number of pages for the email.
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u: SupabaseUser) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 1000) break;
  }
  return null;
}
