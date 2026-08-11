import { Request, Response, NextFunction } from 'express';
import { getAuth, clerkClient } from '@clerk/express';
import prisma from './prisma.js';
import { expandRoles } from '../shared/roles.js';
import {
  roleFromClerkUser,
  nameFromClerkUser,
  primaryEmail,
} from './clerkAdmin.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  clerkUserId: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

const MIRROR_SELECT = {
  id: true,
  clerkUserId: true,
  email: true,
  name: true,
  role: true,
  accountStatus: true,
  isActive: true,
} as const;

type MirrorUser = {
  id: string;
  clerkUserId: string | null;
  email: string;
  name: string;
  role: string;
  accountStatus: string;
  isActive: boolean;
};

/** Clerk returned a 4xx: the session/user is genuinely invalid (not an outage). */
function isClerkClientError(err: any): boolean {
  const status = err?.status ?? err?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Resolve the Postgres mirror row for a verified Clerk user.
 *
 * Resolution order matters — it is what keeps identities stable:
 *   1. `clerkUserId` — the durable link. Survives email changes in Clerk.
 *   2. `email` — claims a pre-Clerk row (Supabase Auth UUID / cuid id) exactly
 *      once and stamps `clerkUserId` on it. The row keeps its primary key, so
 *      every existing relation (reports, profiles, conduct, audit) stays intact.
 *   3. create — a Clerk user with no mirror yet (e.g. created straight in the
 *      Clerk dashboard). Uses the Clerk id as the primary key.
 *
 * Never creates a second row for an email that already exists, and refuses to
 * hand one mirror row to two different Clerk identities.
 */
async function resolveMirror(clerkUserId: string, email: string, name: string, role: string): Promise<MirrorUser> {
  const linked = await prisma.user.findUnique({ where: { clerkUserId }, select: MIRROR_SELECT });
  if (linked) return syncMirror(linked, { email, name, role });

  const byEmail = await prisma.user.findUnique({ where: { email }, select: MIRROR_SELECT });
  if (byEmail) {
    if (byEmail.clerkUserId && byEmail.clerkUserId !== clerkUserId) {
      // Two Clerk identities claiming one application user. Refuse rather than
      // silently re-point the row (which would transfer someone else's data).
      const conflict = new Error('Account identity conflict') as Error & { code: string };
      conflict.code = 'IDENTITY_CONFLICT';
      throw conflict;
    }
    const claimed = await prisma.user.update({
      where: { id: byEmail.id },
      data: { clerkUserId },
      select: MIRROR_SELECT,
    });
    return syncMirror(claimed, { email, name, role });
  }

  try {
    return await prisma.user.create({
      data: { id: clerkUserId, clerkUserId, email, name, role, accountStatus: 'ACTIVE', isActive: true },
      select: MIRROR_SELECT,
    });
  } catch (err: any) {
    // Lost a race with a concurrent request for the same user — read the winner.
    if (err?.code === 'P2002') {
      const existing =
        (await prisma.user.findUnique({ where: { clerkUserId }, select: MIRROR_SELECT })) ??
        (await prisma.user.findUnique({ where: { email }, select: MIRROR_SELECT }));
      if (existing) return existing;
    }
    throw err;
  }
}

/** Keep the mirror's email/name/role in step with Clerk (Clerk is authoritative). */
async function syncMirror(
  dbUser: MirrorUser,
  fresh: { email: string; name: string; role: string },
): Promise<MirrorUser> {
  const data: Record<string, string> = {};
  if (dbUser.email !== fresh.email) data.email = fresh.email;
  if (dbUser.role !== fresh.role) data.role = fresh.role;
  if (fresh.name && dbUser.name !== fresh.name) data.name = fresh.name;
  if (Object.keys(data).length === 0) return dbUser;

  try {
    return await prisma.user.update({ where: { id: dbUser.id }, data, select: MIRROR_SELECT });
  } catch (err: any) {
    // The new Clerk email already belongs to another mirror row: keep serving
    // the request with the stored identity rather than merging two accounts.
    if (err?.code === 'P2002') return dbUser;
    throw err;
  }
}

/**
 * Authentication. The browser signs in with Clerk and sends its session token;
 * `clerkMiddleware()` (mounted in server/app.ts) verifies it before this runs.
 * We read the authenticated Clerk user, take the authoritative role from
 * `publicMetadata` — never from the request body — and mirror the user into the
 * local Postgres `users` table so relational logic keyed on `req.user.id`
 * keeps working unchanged.
 */
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);

  if (!userId) {
    return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Unauthorized' });
  }

  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(userId);
  } catch (err: any) {
    if (isClerkClientError(err)) {
      return res.status(401).json({ code: 'AUTH_INVALID_SESSION', error: 'Unauthorized' });
    }
    // Clerk unreachable / 5xx — an outage, not a rejected credential.
    console.error('[auth] clerk lookup failed:', err?.message || err);
    return res.status(503).json({ code: 'AUTH_PROVIDER_UNAVAILABLE', error: 'Authentication is temporarily unavailable' });
  }

  const email = primaryEmail(clerkUser);
  if (!email) {
    return res.status(401).json({ code: 'AUTH_NO_EMAIL', error: 'Unauthorized' });
  }

  const role = roleFromClerkUser(clerkUser);
  const name = nameFromClerkUser(clerkUser);

  let dbUser: MirrorUser;
  try {
    dbUser = await resolveMirror(clerkUser.id, email, name, role);
  } catch (err: any) {
    if (err?.code === 'IDENTITY_CONFLICT') {
      console.error(`[auth] identity conflict for clerk user ${clerkUser.id}`);
      return res.status(409).json({ code: 'IDENTITY_CONFLICT', error: 'Account identity conflict — contact an administrator' });
    }
    return next(err); // database failure → generic 500 from the error handler
  }

  if (dbUser.accountStatus !== 'ACTIVE' || !dbUser.isActive) {
    return res.status(403).json({ code: 'ACCOUNT_INACTIVE', error: 'Account is not active' });
  }

  req.user = {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    // Role comes from the verified Clerk user (authoritative source).
    role,
    clerkUserId: clerkUser.id,
  };
  next();
}

/**
 * Authorization. `expandRoles` grants the mirrored roles the same access
 * (ADMIN ⇒ DEV, COACH ⇒ PSM, STUDENT ⇒ INTERN). Must always run after
 * `authMiddleware`; a request with no `req.user` is rejected, never allowed.
 */
export function roleMiddleware(roles: string[]) {
  const allowed = expandRoles(roles);
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ code: 'FORBIDDEN', error: 'Forbidden' });
    }
    next();
  };
}
