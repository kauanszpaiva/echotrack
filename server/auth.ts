import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { JWT_SECRET } from './config.js';
import prisma from './prisma.js';

export interface AuthRequest extends Request {
  user?: any;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers?.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearerToken || req.cookies?.token;
  const usedCookieAuth = !bearerToken && Boolean(req.cookies?.token);
  const mutatingRequest = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (usedCookieAuth && mutatingRequest && req.get('sec-fetch-site') === 'cross-site') {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, name: true, role: true, accountStatus: true, isActive: true }
    });

    if (!user || user.accountStatus !== 'ACTIVE' || !user.isActive) {
      return res.status(401).json({ error: 'Account is not active' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function roleMiddleware(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
