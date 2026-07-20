import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Bootstraps the first KSP Dominion Group admin so a fresh deployment actually
// has an account to log in with. EchoTrack has no public admin signup, and the
// Vercel build runs `prisma migrate deploy` (schema only) — without this step a
// brand-new Supabase database has zero users and every login fails.
//
// Runs in ANY environment (including production) but is strictly opt-in and
// idempotent: it only acts when an admin password is supplied via env, and it
// upserts a single fixed admin. No credential is ever committed to the repo.
//
//   BOOTSTRAP_ADMIN_EMAIL     (default: kauan@kspdominion.group)
//   BOOTSTRAP_ADMIN_NAME      (default: Kauan Paiva)
//   BOOTSTRAP_ADMIN_PASSWORD  (or the legacy DEV_ADMIN_PASSWORD)
const ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'kauan@kspdominion.group').trim().toLowerCase();
const ADMIN_NAME = (process.env.BOOTSTRAP_ADMIN_NAME || 'Kauan Paiva').trim();

async function main() {
  // Ensure AppSettings singleton exists.
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.DEV_ADMIN_PASSWORD;

  if (!adminPassword) {
    console.log(
      'Admin bootstrap skipped. Set BOOTSTRAP_ADMIN_PASSWORD (and optionally ' +
        'BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_NAME) to create or refresh the admin login.'
    );
    console.log('Database seeded successfully.');
    return;
  }

  if (adminPassword.length < 8) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters.');
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      password: hashedPassword,
      name: ADMIN_NAME,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      isActive: true,
    },
    create: {
      email: ADMIN_EMAIL,
      password: hashedPassword,
      name: ADMIN_NAME,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      isActive: true,
    },
  });

  console.log(`  • Bootstrapped admin login for ${ADMIN_NAME} <${ADMIN_EMAIL}>`);
  console.log('Database seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
