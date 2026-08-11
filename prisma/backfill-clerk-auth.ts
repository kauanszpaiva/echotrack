import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { provisionClerkUser, isClerkAdminConfigured } from '../server/clerkAdmin.js';

// One-time backfill: create a Clerk identity for every user that already exists
// in the Postgres `users` table, copying their role into publicMetadata.
// Existing Clerk users are left in place (only their role is re-synced).
// Backfilled users get a random password and must use "forgot password" to set
// their own — we never print or store it.
//
// Run once after deploying the Clerk-auth changes:
//   CLERK_SECRET_KEY=... DATABASE_URL=... DIRECT_URL=... \
//     npx tsx prisma/backfill-clerk-auth.ts

const prisma = new PrismaClient();

async function main() {
  if (!isClerkAdminConfigured()) {
    console.error('Missing CLERK_SECRET_KEY. Aborting.');
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, accountStatus: true },
  });

  console.log(`Backfilling ${users.length} user(s) into Clerk...`);
  let processed = 0;
  let failed = 0;

  for (const u of users) {
    // Skip still-pending invites — their Clerk account is created when they
    // accept the invite and set a password via /setup-account.
    if (u.accountStatus === 'INVITED') continue;
    try {
      const tempPassword = crypto.randomBytes(24).toString('base64url');
      await provisionClerkUser({
        email: u.email.toLowerCase(),
        password: tempPassword,
        name: u.name,
        role: u.role,
      });
      // provisionClerkUser is idempotent: it creates a new user or, if one
      // already exists, re-syncs the role.
      processed++;
      console.log(`  ✓ ${u.email} (${u.role})`);
    } catch (e: any) {
      failed++;
      console.error(`  ✗ ${u.email}: ${e.message}`);
    }
  }

  console.log(`Done. processed=${processed} failed=${failed}`);
  console.log('Backfilled users should use "Forgot password" to set their own password.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
