import { PrismaClient } from '@prisma/client';

// Single shared PrismaClient. On serverless (Vercel) each invocation may reuse
// a warm container, so caching the client on globalThis prevents opening a new
// connection pool on every request — which would otherwise exhaust the Supabase
// connection limit. See https://pris.ly/d/help/next-js-best-practices
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
