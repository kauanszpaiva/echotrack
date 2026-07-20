import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Sole KSP Dominion Group admin seeded for local development.
// The email is fixed; the password is supplied via DEV_ADMIN_PASSWORD so no
// credential is ever committed to the repo.
const ADMIN_EMAIL = 'kauan@kspdominion.group';
const ADMIN_NAME = 'Kauan Paiva';

async function main() {
  // Ensure AppSettings
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton'
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const adminPassword = process.env.DEV_ADMIN_PASSWORD;

    if (!adminPassword) {
      console.log('Development admin seed skipped. Set DEV_ADMIN_PASSWORD to create the local admin.');
      return;
    }

    console.log('Development environment detected. Seeding admin account...');

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

    console.log(`  • Seeded admin login for ${ADMIN_NAME} <${ADMIN_EMAIL}>`);
  } else {
    // In production, we assume admins are created via secure commands or initial migrations without defaults.
    console.log('Production environment detected. Skipping insecure default admin seed.');
  }

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
