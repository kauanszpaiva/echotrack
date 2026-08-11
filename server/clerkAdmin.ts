import { clerkClient } from "@clerk/express";
import type { User as ClerkUser } from "@clerk/backend";
import { ALL_ROLES, ROLES } from "../shared/roles.js";

// Server-side Clerk admin helpers. Clerk is the authentication provider:
// it owns identities, passwords, and sessions. The authoritative application
// role is stored in Clerk `publicMetadata.role` (admin-only, not user-editable).
// Supabase Postgres (via Prisma) remains the application database.
//
// CLERK_SECRET_KEY is a SECRET — never expose it to the browser (no VITE_ prefix).

export function isClerkAdminConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

const VALID_ROLES = new Set<string>(ALL_ROLES);

/**
 * The authoritative role for a Clerk user.
 *
 * Fails safe: anything that is not one of the known roles — missing, a typo, a
 * non-string, or an invented value like "SUPERADMIN" — resolves to STUDENT, the
 * least-privileged role. A bad publicMetadata value can never widen access.
 */
export function roleFromClerkUser(user: ClerkUser): string {
  const role = (user.publicMetadata as { role?: unknown } | null)?.role;
  return typeof role === "string" && VALID_ROLES.has(role) ? role : ROLES.STUDENT;
}

export function isValidRole(role: unknown): boolean {
  return typeof role === "string" && VALID_ROLES.has(role);
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

export interface ProvisionedClerkUser {
  /** Clerk user id — the durable identity link stored in `users.clerk_user_id`. */
  id: string;
  /** True when this call created the Clerk user, i.e. it is safe to roll back. */
  created: boolean;
}

/**
 * Create (or reuse) a Clerk user with a role stored in publicMetadata so it is
 * authoritative and cannot be self-edited. Idempotent on email.
 *
 * `created` tells the caller whether it owns the Clerk user: if the subsequent
 * Postgres write fails, only a user we just created may be rolled back
 * (`deleteClerkUser`) — deleting a pre-existing account would destroy a live
 * identity.
 */
export async function provisionClerkUser(params: {
  email: string;
  password: string;
  name: string;
  role: string;
}): Promise<ProvisionedClerkUser> {
  const { email, password, name, role } = params;
  if (!isValidRole(role)) {
    throw new Error(`Refusing to provision Clerk user with unknown role "${role}"`);
  }
  const normalizedEmail = email.toLowerCase();
  const { firstName, lastName } = splitName(name);

  try {
    const created = await clerkClient.users.createUser({
      emailAddress: [normalizedEmail],
      password,
      firstName,
      lastName: lastName || undefined,
      publicMetadata: { role },
    });
    return { id: created.id, created: true };
  } catch (err: any) {
    // If the user already exists in Clerk, keep the authoritative role in sync.
    const existing = await findClerkUserByEmail(normalizedEmail);
    if (existing) {
      await clerkClient.users.updateUserMetadata(existing.id, {
        publicMetadata: { role },
      });
      return { id: existing.id, created: false };
    }
    throw err;
  }
}

/**
 * Compensating action for a failed provisioning transaction: removes a Clerk
 * user this process just created so a Postgres failure cannot leave an
 * orphaned, loginable identity behind. Never throws — the caller is already
 * reporting the original error.
 */
export async function deleteClerkUser(userId: string): Promise<void> {
  try {
    await clerkClient.users.deleteUser(userId);
  } catch (err: any) {
    console.error(`[clerk] rollback failed — orphaned Clerk user ${userId}:`, err?.message || err);
  }
}

/** Update a Clerk user's authoritative role in publicMetadata. */
export async function setClerkUserRole(userId: string, role: string): Promise<void> {
  if (!isValidRole(role)) throw new Error(`Unknown role "${role}"`);
  await clerkClient.users.updateUserMetadata(userId, { publicMetadata: { role } });
}

async function findClerkUserByEmail(email: string): Promise<ClerkUser | null> {
  const { data } = await clerkClient.users.getUserList({
    emailAddress: [email.toLowerCase()],
    limit: 1,
  });
  return data[0] ?? null;
}
