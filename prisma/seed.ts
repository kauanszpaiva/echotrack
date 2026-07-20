import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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
    const adminEmails = (process.env.DEV_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    const adminPassword = process.env.DEV_ADMIN_PASSWORD;

    if (adminEmails.length === 0 || !adminPassword) {
      console.log('Development admin seed skipped. Set DEV_ADMIN_EMAILS and DEV_ADMIN_PASSWORD to create local admins.');
      return;
    }

    console.log('Development environment detected. Seeding configured admins...');
    
    for (const email of adminEmails) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      
      await prisma.user.upsert({
        where: { email },
        update: {
          password: hashedPassword,
          name: 'Kauan Paiva',
          role: 'ADMIN',
          accountStatus: 'ACTIVE',
          isActive: true,
        },
        create: {
          email,
          password: hashedPassword,
          name: 'Kauan Paiva',
          role: 'ADMIN',
          accountStatus: 'ACTIVE',
          isActive: true,
        },
      });
    }
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
