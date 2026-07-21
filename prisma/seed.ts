import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Sole KSP Dominion Group admin (the developer login).
// The email is fixed. The password is read from DEV_ADMIN_PASSWORD when set;
// otherwise it falls back to the known developer password so the login works
// out of the box. Set DEV_ADMIN_PASSWORD in your environment (e.g. Vercel) and
// rotate the credential to keep it out of version control.
const ADMIN_EMAIL = 'kauan@kspdominion.group';
const ADMIN_NAME = 'Kauan Paiva';
const ADMIN_PASSWORD = process.env.DEV_ADMIN_PASSWORD || 'Kauan1901@';

async function main() {
  // Ensure AppSettings
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton'
    }
  });

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  // Always ensure the admin login exists and is active. Upsert keeps the
  // password, role and status in sync on every run, in every environment.
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
