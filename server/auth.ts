import { Request, Response, NextFunction } from 'express';
import prisma from './prisma.js';
import { expandRoles } from '../shared/roles.js';
import {
  getUserFromToken,
  roleFromSupabaseUser,
  nameFromSupabaseUser,
} from './supabaseAdmin.js';

export interface AuthRequest extends Request {
  user?: any;
}

/**
 * Unified authentication: the browser authenticates with Supabase Auth and
 * sends the Supabase access token (Authorization: Bearer <token>). We validate
 * it server-side, read the authoritative role from app_metadata, and mirror the
 * user into the local Postgres `users` table (joined by email) so all existing
 * relational logic keyed on `req.user.id` keeps working unchanged.
 */
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers?.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearerToken || req.cookies?.['sb-access-token'] || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseUser = await getUserFromToken(token);
    if (!supabaseUser || !supabaseUser.email) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const email = supabaseUser.email.toLowerCase();
    const role = roleFromSupabaseUser(supabaseUser);
    const name = nameFromSupabaseUser(supabaseUser);

    // Find the mirrored DB row (join by email). Provision one just-in-time if it
    // doesn't exist yet (e.g. a user created directly in the Supabase dashboard).
    let dbUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, accountStatus: true, isActive: true },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: { id: supabaseUser.id, email, name, role, password: '', accountStatus: 'ACTIVE', isActive: true },
        select: { id: true, email: true, name: true, role: true, accountStatus: true, isActive: true },
      });
    } else if (dbUser.role !== role) {
      // Keep the mirror in sync with the authoritative app_metadata role.
      dbUser = await prisma.user.update({
        where: { email },
        data: { role },
        select: { id: true, email: true, name: true, role: true, accountStatus: true, isActive: true },
      });
    }

    if (dbUser.accountStatus !== 'ACTIVE' || !dbUser.isActive) {
      return res.status(401).json({ error: 'Account is not active' });
    }

    // Role comes from the verified Supabase token (authoritative source).
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
