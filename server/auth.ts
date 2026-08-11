import { Request, Response, NextFunction } from 'express';
import { getAuth, clerkClient } from '@clerk/express';
import prisma from './prisma.js';
import { expandRoles } from '../shared/roles.js';
import {
  roleFromClerkUser,
  nameFromClerkUser,
  primaryEmail,
} from './clerkAdmin.js';

export interface AuthRequest extends Request {
  user?: any;
}

/**
 * Unified authentication: the browser authenticates with Clerk and its session
 * token is verified by `clerkMiddleware()` (mounted in server/app.ts). We read
 * the authenticated Clerk user, take the authoritative role from
 * publicMetadata, and mirror the user into the local Postgres `users` table
 * (joined by email) so all existing relational logic keyed on `req.user.id`
 * keeps working unchanged.
 */
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const { userId } = getAuth(req);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    const email = primaryEmail(clerkUser);
    if (!email) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const role = roleFromClerkUser(clerkUser);
    const name = nameFromClerkUser(clerkUser);

    // Find the mirrored DB row (join by email). Provision one just-in-time if it
    // doesn't exist yet (e.g. a user created directly in the Clerk dashboard).
    let dbUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, accountStatus: true, isActive: true },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: { id: clerkUser.id, email, name, role, password: '', accountStatus: 'ACTIVE', isActive: true },
        select: { id: true, email: true, name: true, role: true, accountStatus: true, isActive: true },
      });
    } else if (dbUser.role !== role) {
      // Keep the mirror in sync with the authoritative publicMetadata role.
      dbUser = await prisma.user.update({
        where: { email },
        data: { role },
        select: { id: true, email: true, name: true, role: true, accountStatus: true, isActive: true },
      });
    }

    if (dbUser.accountStatus !== 'ACTIVE' || !dbUser.isActive) {
      return res.status(401).json({ error: 'Account is not active' });
    }

    // Role comes from the verified Clerk user (authoritative source).
    req.user = { id: dbUser.id, email: dbUser.email, name: dbUser.name, role };
    next();
  } catch (err) {
    console.error('[auth] token verification failed:', err);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function roleMiddleware(roles: string[]) {
  const allowed = expandRoles(roles);
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
