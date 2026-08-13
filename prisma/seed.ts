import { PrismaClient } from '@prisma/client';
import { provisionClerkUser, isClerkAdminConfigured } from '../server/clerkAdmin.js';
import { ROLES, ROLE_LABELS, type UserRole } from '../shared/roles.js';

const prisma = new PrismaClient();

// KSP Dominion Group seed logins. Authentication is unified on Clerk: each
// account is created there (role authoritative in publicMetadata) and mirrored
// into Postgres. No password is ever committed — they come from env vars.
//
//   • The admin is always seeded, gated on DEV_ADMIN_PASSWORD.
//   • One login per remaining role is seeded when DEV_SEED_PASSWORD is set, so
//     every role's dashboard can be signed into during setup and testing.
const ADMIN_EMAIL = 'kauan@kspdominion.group';
const ADMIN_NAME = 'Kauan Paiva';

// One representative login for each non-admin role, on the KSP domain. The admin
// is seeded separately with its own password, so it is intentionally omitted.
const ROLE_LOGINS: { role: UserRole; email: string; name: string }[] = [
  { role: ROLES.DEV, email: 'dev@kspdominion.group', name: 'KSP Dev' },
  { role: ROLES.PROGRAM_MANAGER, email: 'pm@kspdominion.group', name: 'KSP Program Manager' },
  { role: ROLES.COACH, email: 'coach@kspdominion.group', name: 'KSP Coach' },
  { role: ROLES.PSM, email: 'psm@kspdominion.group', name: 'KSP PSM' },
  { role: ROLES.INSTRUCTOR, email: 'instructor@kspdominion.group', name: 'KSP Instructor' },
  { role: ROLES.STUDENT, email: 'student@kspdominion.group', name: 'KSP Student' },
  { role: ROLES.INTERN, email: 'intern@kspdominion.group', name: 'KSP Intern' },
];

/**
 * Provision one login in Clerk and mirror it into Postgres. Matched by email so
 * an existing row keeps its primary key (and all its relations) and simply
 * gains / refreshes its Clerk identity link. Idempotent — safe to re-run.
 */
async function seedLogin(params: { email: string; password: string; name: string; role: UserRole }) {
  const { email, password, name, role } = params;

  const clerkUser = await provisionClerkUser({ email, password, name, role });

  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role,
      accountStatus: 'ACTIVE',
      isActive: true,
      clerkUserId: clerkUser.id,
    },
    create: {
      id: clerkUser.id,
      clerkUserId: clerkUser.id,
      email,
      name,
      role,
      accountStatus: 'ACTIVE',
      isActive: true,
    },
  });

  console.log(`  • Seeded ${ROLE_LABELS[role]} ${name} <${email}> (Clerk + Postgres)`);
}

async function main() {
  // Ensure AppSettings singleton exists.
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  if (!isClerkAdminConfigured()) {
    console.log('Seed skipped: set CLERK_SECRET_KEY to provision logins in Clerk.');
    return;
  }

  const adminPassword = process.env.DEV_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.log('Admin seed skipped: set DEV_ADMIN_PASSWORD to create the admin login.');
  } else {
    console.log('Provisioning admin in Clerk...');
    await seedLogin({ email: ADMIN_EMAIL, password: adminPassword, name: ADMIN_NAME, role: ROLES.ADMIN });
  }

  // Per-role logins share one password so the whole set can be created in a
  // single run; leave DEV_SEED_PASSWORD unset to skip them (e.g. production).
  const seedPassword = process.env.DEV_SEED_PASSWORD;
  if (!seedPassword) {
    console.log('Role logins skipped: set DEV_SEED_PASSWORD to create one login per role.');
  } else {
    console.log(`Provisioning ${ROLE_LOGINS.length} role logins in Clerk...`);
    for (const login of ROLE_LOGINS) {
      await seedLogin({ ...login, password: seedPassword });
    }
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
