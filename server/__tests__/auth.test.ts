import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prismaMock, resetPrismaMock, resetStore, store, type SeedUser } from './testDb.js';

// ── Test doubles ────────────────────────────────────────────────────────────
// Clerk is the identity provider; here it is stubbed so the tests exercise our
// verification/authorization logic, not Clerk's network calls.

const clerkState: {
  userId: string | null;
  user: any;
  getUserError: any;
} = { userId: null, user: null, getUserError: null };

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: clerkState.userId }),
  clerkClient: {
    users: {
      getUser: vi.fn(async () => {
        if (clerkState.getUserError) throw clerkState.getUserError;
        return clerkState.user;
      }),
      createUser: vi.fn(),
      deleteUser: vi.fn(),
      getUserList: vi.fn(async () => ({ data: [] })),
      updateUserMetadata: vi.fn(),
    },
  },
}));

vi.mock('../prisma.js', () => ({ default: prismaMock, prisma: prismaMock }));

// The app refuses to serve protected routes unless Clerk is configured; these
// tests exercise the configured path (Clerk itself is mocked above).
process.env.CLERK_SECRET_KEY = 'sk_test_stub';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_stub';

const { default: app } = await import('../app.js');

function clerkUser(overrides: { id?: string; email?: string; role?: unknown } = {}) {
  const id = overrides.id ?? 'user_clerk_1';
  const email = overrides.email ?? 'person@kspdominion.group';
  return {
    id,
    primaryEmailAddressId: 'idn_1',
    emailAddresses: [{ id: 'idn_1', emailAddress: email }],
    firstName: 'Test',
    lastName: 'Person',
    publicMetadata: 'role' in overrides ? { role: overrides.role } : {},
  };
}

/** Sign in as a Clerk user with the given role in publicMetadata. */
function signIn(role: unknown, opts: { id?: string; email?: string } = {}) {
  const user = clerkUser({ ...opts, role });
  clerkState.userId = user.id;
  clerkState.user = user;
  clerkState.getUserError = null;
  return user;
}

function signOut() {
  clerkState.userId = null;
  clerkState.user = null;
  clerkState.getUserError = null;
}

function seed(users: SeedUser[]) {
  resetStore(users);
}

beforeEach(() => {
  resetPrismaMock();
  signOut();
  seed([]);
});

// ── 1. Session verification ─────────────────────────────────────────────────

describe('session verification', () => {
  it('rejects a request with no session', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('rejects a session token Clerk does not recognise', async () => {
    clerkState.userId = 'user_deleted';
    clerkState.getUserError = Object.assign(new Error('Not Found'), { status: 404 });
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_INVALID_SESSION');
  });

  it('reports a Clerk outage as 503, not as an auth failure', async () => {
    clerkState.userId = 'user_clerk_1';
    clerkState.getUserError = Object.assign(new Error('Bad Gateway'), { status: 502 });
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUTH_PROVIDER_UNAVAILABLE');
  });

  it('serves an authenticated admin', async () => {
    const user = signIn('ADMIN');
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'ADMIN' }]);
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(200);
  });

  it('does not leak database internals when Postgres is unavailable', async () => {
    const user = signIn('ADMIN');
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'ADMIN' }]);
    store.failNextQuery = true;
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|5432/);
  });
});

// ── 2. Account state ────────────────────────────────────────────────────────

describe('account state', () => {
  it('locks out a deactivated account even with a valid Clerk session', async () => {
    const user = signIn('ADMIN');
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'ADMIN', isActive: false }]);
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });

  it('locks out an account that has not completed its invite', async () => {
    const user = signIn('COACH');
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'COACH', accountStatus: 'INVITED' }]);
    const res = await request(app).get('/api/coach/students');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });
});

// ── 3. Role resolution ──────────────────────────────────────────────────────

describe('role resolution', () => {
  it('takes the role from Clerk publicMetadata, not from the database mirror', async () => {
    const user = signIn('STUDENT');
    // The mirror claims ADMIN; Clerk says STUDENT. Clerk wins.
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'ADMIN' }]);
    const res = await request(app).get('/api/admin/settings');
    expect(res.status).toBe(403);
    expect(store.users[0].role).toBe('STUDENT'); // mirror re-synced downwards
  });

  it('falls back to the least-privileged role for an unknown publicMetadata role', async () => {
    const user = signIn('SUPERADMIN');
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'STUDENT' }]);
    const res = await request(app).get('/api/admin/settings');
    expect(res.status).toBe(403);
  });

  it('falls back to the least-privileged role when publicMetadata has no role', async () => {
    const user = signIn(undefined);
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'STUDENT' }]);
    const res = await request(app).get('/api/admin/settings');
    expect(res.status).toBe(403);
  });

  it('ignores a role supplied by the client in the request body', async () => {
    const user = signIn('STUDENT');
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'STUDENT' }]);
    const res = await request(app)
      .post('/api/targeted-questions')
      .send({ role: 'ADMIN', user: { role: 'ADMIN' }, question: 'q', studentId: 'u1' });
    expect(res.status).toBe(403);
  });
});

// ── 4. Cross-role authorization (negative tests) ────────────────────────────

const ADMIN_ONLY = '/api/admin/settings';
const ADMIN_OR_PM = '/api/admin/users';
const COACH_ONLY = '/api/coach/students';
const INSTRUCTOR_ONLY = '/api/instructor/classes';
const PM_ONLY = '/api/pm/students';
const STUDENT_ONLY = '/api/student/classes';

const matrix: Array<[string, string, number]> = [
  // Students and interns are confined to their own area.
  ['STUDENT', ADMIN_ONLY, 403],
  ['STUDENT', ADMIN_OR_PM, 403],
  ['STUDENT', COACH_ONLY, 403],
  ['STUDENT', PM_ONLY, 403],
  ['INTERN', ADMIN_ONLY, 403],
  ['INTERN', STUDENT_ONLY, 200],
  // Coaches cannot reach admin-only or PM-only areas.
  ['COACH', ADMIN_ONLY, 403],
  ['COACH', ADMIN_OR_PM, 403],
  ['COACH', PM_ONLY, 403],
  ['COACH', COACH_ONLY, 200],
  ['PSM', ADMIN_ONLY, 403],
  ['PSM', COACH_ONLY, 200],
  // Instructors stay inside their scope.
  ['INSTRUCTOR', ADMIN_ONLY, 403],
  ['INSTRUCTOR', COACH_ONLY, 403],
  ['INSTRUCTOR', INSTRUCTOR_ONLY, 200],
  // Program Managers share some admin screens but not admin-only ones.
  ['PROGRAM_MANAGER', ADMIN_ONLY, 403],
  ['PROGRAM_MANAGER', ADMIN_OR_PM, 200],
  ['PROGRAM_MANAGER', PM_ONLY, 200],
  // Admin and Dev have the run of the admin area.
  ['ADMIN', ADMIN_ONLY, 200],
  ['ADMIN', ADMIN_OR_PM, 200],
  ['DEV', ADMIN_ONLY, 200],
  ['DEV', PM_ONLY, 403],
];

describe('authorization matrix', () => {
  it.each(matrix)('%s → %s = %i', async (role, path, expected) => {
    const user = signIn(role);
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role }]);
    const res = await request(app).get(path);
    expect(res.status).toBe(expected);
  });
});

// ── 5. Clerk ↔ Postgres identity mirror ─────────────────────────────────────

describe('user mirror', () => {
  it('claims a pre-Clerk row by email and keeps its primary key', async () => {
    // Legacy row: Supabase Auth UUID as the id, no Clerk link yet.
    seed([{ id: '7112b4c9-fe1c-411e-a827-9f790b252f0d', email: 'legacy@kspdominion.group', role: 'ADMIN' }]);
    const user = signIn('ADMIN', { id: 'user_clerk_new', email: 'legacy@kspdominion.group' });

    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(200);
    expect(store.users).toHaveLength(1); // no duplicate account
    expect(store.users[0].id).toBe('7112b4c9-fe1c-411e-a827-9f790b252f0d'); // relations survive
    expect(store.users[0].clerkUserId).toBe(user.id);
  });

  it('is idempotent — a second request creates nothing new', async () => {
    seed([{ id: 'legacy-1', email: 'legacy@kspdominion.group', role: 'ADMIN' }]);
    signIn('ADMIN', { id: 'user_clerk_new', email: 'legacy@kspdominion.group' });

    await request(app).get('/api/admin/users');
    await request(app).get('/api/admin/users');

    expect(store.users).toHaveLength(1);
  });

  it('follows an email change in Clerk by the identity link, not by email', async () => {
    seed([{ id: 'u1', clerkUserId: 'user_clerk_1', email: 'old@kspdominion.group', role: 'ADMIN' }]);
    signIn('ADMIN', { id: 'user_clerk_1', email: 'new@kspdominion.group' });

    await request(app).get('/api/admin/users');

    expect(store.users).toHaveLength(1);
    expect(store.users[0].id).toBe('u1');
    expect(store.users[0].email).toBe('new@kspdominion.group');
  });

  it('refuses to hand one application account to a second Clerk identity', async () => {
    seed([{ id: 'u1', clerkUserId: 'user_clerk_original', email: 'person@kspdominion.group', role: 'ADMIN' }]);
    signIn('ADMIN', { id: 'user_clerk_impostor', email: 'person@kspdominion.group' });

    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDENTITY_CONFLICT');
    expect(store.users[0].clerkUserId).toBe('user_clerk_original');
  });

  it('provisions a mirror for a Clerk user created outside the app', async () => {
    seed([]);
    const user = signIn('STUDENT', { id: 'user_dashboard_created', email: 'fresh@kspdominion.group' });

    const res = await request(app).get('/api/student/classes');

    expect(res.status).toBe(200);
    expect(store.users).toHaveLength(1);
    expect(store.users[0].id).toBe(user.id);
    expect(store.users[0].clerkUserId).toBe(user.id);
    expect(store.users[0].role).toBe('STUDENT');
  });

  it('re-syncs the mirrored role when it drifts from Clerk', async () => {
    seed([{ id: 'u1', clerkUserId: 'user_clerk_1', email: 'person@kspdominion.group', role: 'STUDENT' }]);
    signIn('COACH', { id: 'user_clerk_1' });

    const res = await request(app).get('/api/coach/students');

    expect(res.status).toBe(200);
    expect(store.users[0].role).toBe('COACH');
  });
});

// ── 6. Legacy auth surface is gone ──────────────────────────────────────────

describe('legacy authentication surface', () => {
  it('no longer exposes the password login endpoint', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'person@kspdominion.group', password: 'whatever' });
    expect(res.status).toBe(404);
  });

  it('no longer exposes the cookie logout endpoint', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(404);
  });

  it('never sets an authentication cookie of its own', async () => {
    const user = signIn('ADMIN');
    seed([{ id: 'u1', clerkUserId: user.id, email: 'person@kspdominion.group', role: 'ADMIN' }]);
    const res = await request(app).get('/api/admin/users');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
