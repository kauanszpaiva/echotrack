import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Creates (or repairs) the first EchoTrack admin login.
 *
 * `prisma/seed.ts` deliberately refuses to run in production, which leaves a
 * fresh deployment with no way to sign in: every account-creating API route is
 * itself behind an admin session. This script closes that gap. It is idempotent,
 * takes the credential from the environment, and never hardcodes a password.
 *
 *   ADMIN_EMAIL="kauan@kspdominion.group" \
 *   ADMIN_PASSWORD="..." \
 *   DATABASE_URL="..." DIRECT_URL="..." \
 *   npm run db:bootstrap-admin
 */
const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 12;

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = (process.env.ADMIN_NAME || '').trim() || 'EchoTrack Admin';

  if (!email || !email.includes('@')) {
    throw new Error('Set ADMIN_EMAIL to the administrator email address.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Set ADMIN_PASSWORD to at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      isActive: true,
      inviteToken: null,
    },
    create: {
      email,
      name,
      password: hashedPassword,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      isActive: true,
    },
  });

  // AppSettings is a singleton the admin dashboard expects to exist.
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  console.log(`Admin ready: ${admin.name} <${admin.email}> (role ${admin.role}, status ${admin.accountStatus})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
