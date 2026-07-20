import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface AdminUser {
  email: string;
  name: string;
}

// Known KSP Dominion Group admins, keyed by the local-part of their email.
// Ensures each seeded login keeps its correct name instead of a shared default.
const KNOWN_ADMIN_NAMES: Record<string, string> = {
  kauan: 'Kauan Paiva',
  kayla: 'Kayla Paiva',
  karla: 'Karla Paiva',
};

const DEFAULT_ADMIN_NAME = 'KSP Admin';

function titleCase(value: string): string {
  return value
    .split(/[.\-_+\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function nameForEmail(email: string): string {
  const localPart = email.split('@')[0] || '';
  const key = localPart.toLowerCase();

  // Exact match on the local-part first (e.g. kauan@...).
  if (KNOWN_ADMIN_NAMES[key]) {
    return KNOWN_ADMIN_NAMES[key];
  }

  // Otherwise match on a known first name appearing in the local-part
  // (e.g. kauan.paiva@..., kayla-ksp@...).
  for (const [known, name] of Object.entries(KNOWN_ADMIN_NAMES)) {
    if (key.split(/[.\-_+]/).includes(known)) {
      return name;
    }
  }

  const derived = titleCase(localPart);
  return derived || DEFAULT_ADMIN_NAME;
}

// Parses admin users from env. Two supported formats:
//   1. DEV_ADMIN_USERS="Kauan Paiva:kauan@ksp.dev,Kayla Paiva:kayla@ksp.dev"
//      (explicit "Name:email" pairs, most robust)
//   2. DEV_ADMIN_EMAILS="kauan@ksp.dev,kayla@ksp.dev,karla@ksp.dev"
//      (email-only; the display name is resolved from KNOWN_ADMIN_NAMES)
function parseAdminUsers(): AdminUser[] {
  const explicit = (process.env.DEV_ADMIN_USERS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const sepIndex = entry.lastIndexOf(':');
      const name = sepIndex > 0 ? entry.slice(0, sepIndex).trim() : '';
      const email = (sepIndex > 0 ? entry.slice(sepIndex + 1) : entry).trim().toLowerCase();
      return { email, name: name || nameForEmail(email) };
    })
    .filter((user) => Boolean(user.email));

  if (explicit.length > 0) {
    return dedupeByEmail(explicit);
  }

  const fromEmails = (process.env.DEV_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .map((email) => ({ email, name: nameForEmail(email) }));

  return dedupeByEmail(fromEmails);
}

function dedupeByEmail(users: AdminUser[]): AdminUser[] {
  const seen = new Map<string, AdminUser>();
  for (const user of users) {
    seen.set(user.email, user);
  }
  return [...seen.values()];
}

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
    const adminUsers = parseAdminUsers();
    const adminPassword = process.env.DEV_ADMIN_PASSWORD;

    if (adminUsers.length === 0 || !adminPassword) {
      console.log('Development admin seed skipped. Set DEV_ADMIN_EMAILS and DEV_ADMIN_PASSWORD to create local admins.');
      return;
    }

    console.log('Development environment detected. Seeding configured admins...');

    for (const { email, name } of adminUsers) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);

      await prisma.user.upsert({
        where: { email },
        update: {
          password: hashedPassword,
          name,
          role: 'ADMIN',
          accountStatus: 'ACTIVE',
          isActive: true,
        },
        create: {
          email,
          password: hashedPassword,
          name,
          role: 'ADMIN',
          accountStatus: 'ACTIVE',
          isActive: true,
        },
      });

      console.log(`  • Seeded admin login for ${name} <${email}>`);
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
