import { PrismaClient } from '@prisma/client';
import { provisionSupabaseAuthUser, isSupabaseAdminConfigured } from '../server/supabaseAdmin.js';

const prisma = new PrismaClient();

// Sole KSP Dominion Group admin seeded on setup. The email is fixed; the
// password is supplied via DEV_ADMIN_PASSWORD so no credential is committed.
// Authentication is unified on Supabase Auth: the admin is created there (role
// authoritative in app_metadata) and mirrored into Postgres.
const ADMIN_EMAIL = 'kauan@kspdominion.group';
const ADMIN_NAME = 'Kauan Paiva';

async function main() {
  // Ensure AppSettings singleton exists.
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  const adminPassword = process.env.DEV_ADMIN_PASSWORD;

  if (!isSupabaseAdminConfigured()) {
    console.log('Admin seed skipped: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to provision the admin in Supabase Auth.');
    return;
  }
  if (!adminPassword) {
    console.log('Admin seed skipped: set DEV_ADMIN_PASSWORD to create the admin login.');
    return;
  }

  console.log('Provisioning admin in Supabase Auth...');
  const supabaseUserId = await provisionSupabaseAuthUser({
    email: ADMIN_EMAIL,
    password: adminPassword,
    name: ADMIN_NAME,
    role: 'ADMIN',
  });

  // Mirror into Postgres (joined by email; keep the Supabase id on create).
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { name: ADMIN_NAME, role: 'ADMIN', accountStatus: 'ACTIVE', isActive: true },
    create: {
      id: supabaseUserId,
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      isActive: true,
      password: '',
    },
  });

  console.log(`  • Seeded admin ${ADMIN_NAME} <${ADMIN_EMAIL}> (Supabase + Postgres)`);
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
