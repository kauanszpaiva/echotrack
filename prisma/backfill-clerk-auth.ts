import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { provisionClerkUser, isClerkAdminConfigured } from '../server/clerkAdmin.js';

// Backfill: give every existing Postgres user a Clerk identity and store the
// link in `users.clerk_user_id`.
//
// Safety properties:
//   • Idempotent — re-running it changes nothing for already-linked users.
//   • Non-destructive — never deletes, never changes a primary key, so all
//     existing relations (reports, profiles, conduct entries) stay intact.
//     Rows created before Clerk keep their old id (Supabase Auth UUID / cuid).
//   • Never invents privileges — the role written to Clerk publicMetadata is
//     the role already stored in Postgres.
//   • Backfilled users get a random password that is never printed or stored;
//     they set their own via "Forgot password".
//   • Still-pending invites are skipped: their Clerk account is created when
//     they accept the invite at /setup-account.
//
// Dry run (default) prints the plan without writing anything:
//   CLERK_SECRET_KEY=... DATABASE_URL=... DIRECT_URL=... \
//     npx tsx prisma/backfill-clerk-auth.ts
// Apply:
//   ... npx tsx prisma/backfill-clerk-auth.ts --apply

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  if (!isClerkAdminConfigured()) {
    console.error('Missing CLERK_SECRET_KEY. Aborting.');
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, accountStatus: true, clerkUserId: true },
    orderBy: { createdAt: 'asc' },
  });

  const pending = users.filter((u) => u.accountStatus !== 'INVITED' && !u.clerkUserId);
  const skippedInvites = users.filter((u) => u.accountStatus === 'INVITED').length;
  const alreadyLinked = users.filter((u) => u.clerkUserId).length;

  console.log(
    `${users.length} user(s): ${alreadyLinked} already linked, ${skippedInvites} pending invite(s) skipped, ${pending.length} to backfill.`
  );
  if (!APPLY) {
    for (const u of pending) console.log(`  would link ${u.email} (${u.role})`);
    console.log('\nDry run — nothing was written. Re-run with --apply to perform the backfill.');
    return;
  }

  let linked = 0;
  let failed = 0;

  for (const u of pending) {
    try {
      const tempPassword = crypto.randomBytes(24).toString('base64url');
      // Idempotent: creates the Clerk user, or reuses the existing one for this
      // email and re-syncs its role.
      const clerkUser = await provisionClerkUser({
        email: u.email.toLowerCase(),
        password: tempPassword,
        name: u.name,
        role: u.role,
      });

      // Store the link. `updateMany` with a null guard makes this a no-op if a
      // concurrent sign-in already linked the row.
      const result = await prisma.user.updateMany({
        where: { id: u.id, clerkUserId: null },
        data: { clerkUserId: clerkUser.id },
      });
      linked += result.count;
      console.log(`  ✓ ${u.email} (${u.role})${result.count ? '' : ' — already linked, skipped'}`);
    } catch (e: any) {
      failed++;
      console.error(`  ✗ ${u.email}: ${e.message}`);
    }
  }

  console.log(`Done. linked=${linked} failed=${failed}`);
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
