import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Seeds the AppSettings singleton and (optionally) the first admin login.
//
// The admin credential is NEVER hardcoded. Provide it via environment:
//   DEV_ADMIN_EMAIL    (optional, defaults to kauan@kspdominion.group)
//   DEV_ADMIN_PASSWORD (required to create/refresh the admin — no default)
//
// Run once per environment, e.g.:
//   DEV_ADMIN_PASSWORD='a-strong-password' npm run db:seed
const ADMIN_EMAIL = (process.env.DEV_ADMIN_EMAIL || 'kauan@kspdominion.group').toLowerCase();
const ADMIN_NAME = 'Kauan Paiva';
const ADMIN_PASSWORD = process.env.DEV_ADMIN_PASSWORD;

async function main() {
  // Always ensure the AppSettings singleton exists.
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  console.log('  • Ensured AppSettings singleton');

  if (!ADMIN_PASSWORD) {
    console.warn(
      '  ! DEV_ADMIN_PASSWORD not set — skipping admin seed. ' +
      'Set DEV_ADMIN_PASSWORD (and optionally DEV_ADMIN_EMAIL) to create the admin login.'
    );
    console.log('Database seeded successfully (settings only).');
    return;
  }

  if (ADMIN_PASSWORD.length < 8) {
    throw new Error('DEV_ADMIN_PASSWORD must be at least 8 characters.');
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Upsert keeps the password, role and status in sync on every run.
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

  console.log(`  • Seeded admin login for ${ADMIN_NAME} <${ADMIN_EMAIL}>`);
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
