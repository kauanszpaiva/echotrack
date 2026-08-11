import { clerkClient } from "@clerk/express";
import type { User as ClerkUser } from "@clerk/backend";

// Server-side Clerk admin helpers. Clerk is the authentication provider:
// it owns identities, passwords, and sessions. The authoritative application
// role is stored in Clerk `publicMetadata.role` (admin-only, not user-editable).
// Supabase Postgres (via Prisma) remains the application database.
//
// CLERK_SECRET_KEY is a SECRET — never expose it to the browser (no VITE_ prefix).

export function isClerkAdminConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

/** The authoritative role for a Clerk user: publicMetadata first, else STUDENT. */
export function roleFromClerkUser(user: ClerkUser): string {
  const role = (user.publicMetadata as any)?.role;
  return typeof role === "string" && role ? role : "STUDENT";
}

export function nameFromClerkUser(user: ClerkUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  const email = primaryEmail(user);
  return email?.split("@")[0] || "User";
}

export function primaryEmail(user: ClerkUser): string | null {
  const primaryId = user.primaryEmailAddressId;
  const match = user.emailAddresses.find((e) => e.id === primaryId) ?? user.emailAddresses[0];
  return match?.emailAddress?.toLowerCase() ?? null;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  const firstName = parts.shift() || name.trim();
  const lastName = parts.join(" ");
  return { firstName, lastName };
}

/**
 * Create (or reuse) a Clerk user with a role stored in publicMetadata so it is
 * authoritative and cannot be self-edited. Idempotent on email. Returns the
 * Clerk user id (used as the primary key mirror in Postgres for new users).
 */
export async function provisionClerkUser(params: {
  email: string;
  password: string;
  name: string;
  role: string;
}): Promise<string> {
  const { email, password, name, role } = params;
  const normalizedEmail = email.toLowerCase();
  const { firstName, lastName } = splitName(name);

  try {
    const created = await clerkClient.users.createUser({
      emailAddress: [normalizedEmail],
      password,
      firstName,
      lastName: lastName || undefined,
      publicMetadata: { role },
      skipPasswordChecks: true,
    });
    return created.id;
  } catch (err: any) {
    // If the user already exists in Clerk, keep the authoritative role in sync.
    const existing = await findClerkUserByEmail(normalizedEmail);
    if (existing) {
      await clerkClient.users.updateUserMetadata(existing.id, {
        publicMetadata: { role },
      });
      return existing.id;
    }
    throw err;
  }
}

/** Update a Clerk user's authoritative role in publicMetadata. */
export async function setClerkUserRole(userId: string, role: string): Promise<void> {
  await clerkClient.users.updateUserMetadata(userId, { publicMetadata: { role } });
}

async function findClerkUserByEmail(email: string): Promise<ClerkUser | null> {
  const { data } = await clerkClient.users.getUserList({
    emailAddress: [email.toLowerCase()],
    limit: 1,
  });
  return data[0] ?? null;
}
