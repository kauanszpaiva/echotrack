// Authorization and behaviour tests for the student engagement domain.
//
// The point of this file is the *negative* cases: the migration brief requires
// that changing an id in a URL is not enough to reach another student's data.
// Each "denied" case asserts 404 rather than 403 — a 403 would confirm the
// record exists, which is a disclosure of its own when ids are being probed.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prismaMock, resetPrismaMock, resetStore, seedTable, tables, type SeedUser } from './testDb.js';

const clerkState: { userId: string | null; user: any; getUserError: any } = {
  userId: null,
  user: null,
  getUserError: null,
};

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

process.env.CLERK_SECRET_KEY = 'sk_test_stub';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_stub';

const { default: app } = await import('../app.js');

function signIn(role: string, opts: { id?: string; email?: string } = {}) {
  const id = opts.id ?? 'user_clerk_1';
  const email = opts.email ?? 'person@kspdominion.group';
  const user = {
    id,
    primaryEmailAddressId: 'idn_1',
    emailAddresses: [{ id: 'idn_1', emailAddress: email }],
    firstName: 'Test',
    lastName: 'Person',
    publicMetadata: { role },
  };
  clerkState.userId = id;
  clerkState.user = user;
  clerkState.getUserError = null;
  return user;
}

function signOut() {
  clerkState.userId = null;
  clerkState.user = null;
  clerkState.getUserError = null;
}

/** Sign in as `role` and mirror them as `mirrorId` in the users table. */
function actor(role: string, mirrorId: string, others: SeedUser[] = []) {
  const clerkId = `user_clerk_${mirrorId}`;
  signIn(role, { id: clerkId, email: `${mirrorId}@kspdominion.group` });
  resetStore([
    { id: mirrorId, clerkUserId: clerkId, email: `${mirrorId}@kspdominion.group`, role },
    ...others,
  ]);
}

beforeEach(() => {
  resetPrismaMock();
  signOut();
  resetStore([]);
});

// ── 1. Unauthenticated ─────────────────────────────────────────────────────

describe('unauthenticated access', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['get', '/api/student/daily-checkin'],
    ['post', '/api/student/daily-checkin'],
    ['get', '/api/student/weekly-goals'],
    ['get', '/api/student/templates'],
    ['get', '/api/coaching-goals/s1'],
    ['get', '/api/annotations?reportId=r1'],
  ];

  it.each(protectedRoutes)('%s %s → 401', async (method, path) => {
    const res = await (request(app) as any)[method](path);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });
});

// ── 2. Student reaches only their own records ──────────────────────────────

describe('student self-scope', () => {
  it('reads its own check-ins', async () => {
    actor('STUDENT', 's1');
    seedTable('dailyCheckIn', [
      { id: 'c1', studentId: 's1', moodEmoji: '🙂', energyLevel: 7 },
      { id: 'c2', studentId: 's2', moodEmoji: '😐', energyLevel: 4 },
    ]);

    const res = await request(app).get('/api/student/daily-checkin');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('c1');
  });

  it('ignores a studentId in the query string rather than honouring it', async () => {
    actor('STUDENT', 's1');
    seedTable('dailyCheckIn', [
      { id: 'c1', studentId: 's1', moodEmoji: '🙂', energyLevel: 7 },
      { id: 'c2', studentId: 's2', moodEmoji: '😐', energyLevel: 4 },
    ]);

    const res = await request(app).get('/api/student/daily-checkin?studentId=s2');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].studentId).toBe('s1'); // never s2
  });

  it('writes a check-in against the session user, not a body-supplied id', async () => {
    actor('STUDENT', 's1');

    const res = await request(app)
      .post('/api/student/daily-checkin')
      .send({ studentId: 's2', moodEmoji: '🙂', energyLevel: 8, notes: 'good week' });

    expect(res.status).toBe(201);
    expect(res.body.studentId).toBe('s1');
  });

  it('cannot patch another student\'s goal', async () => {
    actor('STUDENT', 's1');
    seedTable('weeklyGoal', [{ id: 'g9', studentId: 's2', title: 'Theirs', status: 'PENDING' }]);

    const res = await request(app).patch('/api/student/weekly-goals/g9').send({ status: 'COMPLETED' });

    expect(res.status).toBe(404);
    expect(tables.weeklyGoal[0].status).toBe('PENDING'); // untouched
  });

  it('cannot delete another student\'s template', async () => {
    actor('STUDENT', 's1');
    seedTable('studentTemplate', [{ id: 't9', studentId: 's2', title: 'Theirs', type: 'NOTE', content: 'x' }]);

    const res = await request(app).delete('/api/student/templates/t9');

    expect(res.status).toBe(404);
    expect(tables.studentTemplate).toHaveLength(1);
  });

  it('rejects an invalid payload with 400', async () => {
    actor('STUDENT', 's1');
    const res = await request(app).post('/api/student/daily-checkin').send({ moodEmoji: '🙂', energyLevel: 99 });
    expect(res.status).toBe(400);
  });
});

// ── 3. Coach scope ─────────────────────────────────────────────────────────

describe('coach → student scope', () => {
  it('reads an assigned student', async () => {
    actor('COACH', 'coach1');
    seedTable('studentProfile', [{ id: 'p1', userId: 's1', coachId: 'coach1' }]);
    seedTable('dailyCheckIn', [{ id: 'c1', studentId: 's1', moodEmoji: '🙂', energyLevel: 7 }]);

    const res = await request(app).get('/api/student/daily-checkin?studentId=s1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('is refused an unassigned student — by changing the id alone', async () => {
    actor('COACH', 'coach1');
    seedTable('studentProfile', [
      { id: 'p1', userId: 's1', coachId: 'coach1' },
      { id: 'p2', userId: 's2', coachId: 'coach2' },
    ]);
    seedTable('dailyCheckIn', [{ id: 'c2', studentId: 's2', moodEmoji: '😐', energyLevel: 3 }]);

    const res = await request(app).get('/api/student/daily-checkin?studentId=s2');

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('0');
  });

  it('cannot create a coaching goal for an unassigned student', async () => {
    actor('COACH', 'coach1');
    seedTable('studentProfile', [{ id: 'p2', userId: 's2', coachId: 'coach2' }]);

    const res = await request(app)
      .post('/api/coaching-goals')
      .send({ studentId: 's2', title: 'Not mine to set' });

    expect(res.status).toBe(404);
    expect(tables.coachingGoal ?? []).toHaveLength(0);
  });

  it('creates a coaching goal for an assigned student', async () => {
    actor('COACH', 'coach1');
    seedTable('studentProfile', [{ id: 'p1', userId: 's1', coachId: 'coach1' }]);

    const res = await request(app)
      .post('/api/coaching-goals')
      .send({ studentId: 's1', title: 'Attend every session' });

    expect(res.status).toBe(201);
    expect(res.body.coachId).toBe('coach1');
  });

  it('cannot annotate a report belonging to an unassigned student', async () => {
    actor('COACH', 'coach1');
    seedTable('studentProfile', [{ id: 'p2', userId: 's2', coachId: 'coach2' }]);
    seedTable('weeklyReport', [{ id: 'r2', studentId: 's2' }]);

    const res = await request(app)
      .post('/api/annotations')
      .send({ reportId: 'r2', section: 'highlights', note: 'internal' });

    expect(res.status).toBe(404);
    expect(tables.annotation ?? []).toHaveLength(0);
  });
});

// ── 4. PSM isolation ───────────────────────────────────────────────────────
// `expandRoles` lets PSM clear a COACH route gate. The scope layer is the only
// place the distinction survives, so it is asserted here explicitly.

describe('PSM isolation', () => {
  it('is refused a coaching resource even for a student assigned to them', async () => {
    actor('PSM', 'psm1');
    seedTable('studentProfile', [{ id: 'p1', userId: 's1', coachId: 'psm1' }]);
    seedTable('dailyCheckIn', [{ id: 'c1', studentId: 's1', moodEmoji: '🙂', energyLevel: 7 }]);

    const res = await request(app).get('/api/student/daily-checkin?studentId=s1');

    // allowPsm is not set on this route, so holding the PSM role grants nothing.
    expect(res.status).toBe(404);
  });
});

// ── 5. Student cannot reach staff-only surfaces ────────────────────────────

describe('student → staff routes', () => {
  it('is refused the annotations surface', async () => {
    actor('STUDENT', 's1');
    seedTable('weeklyReport', [{ id: 'r1', studentId: 's1' }]);

    const res = await request(app).get('/api/annotations?reportId=r1');

    expect(res.status).toBe(403);
  });

  it('is refused the class-change decision surface for its own request', async () => {
    actor('STUDENT', 's1');
    seedTable('classChangeRequest', [{ id: 'cr1', studentId: 's1', classId: 'k1', action: 'ADD', status: 'PENDING' }]);

    const res = await request(app).patch('/api/student/class-requests/cr1').send({ status: 'APPROVED' });

    expect(res.status).toBe(403);
    expect(tables.classChangeRequest[0].status).toBe('PENDING');
  });
});

// ── 6. Program manager decisions are program-scoped ────────────────────────

describe('program manager scope', () => {
  it('decides a request for a student in their program', async () => {
    actor('PROGRAM_MANAGER', 'pm1');
    seedTable('studentProfile', [{ id: 'p1', userId: 's1', programManagerId: 'pm1' }]);
    seedTable('classChangeRequest', [{ id: 'cr1', studentId: 's1', classId: 'k1', action: 'ADD', status: 'PENDING' }]);

    const res = await request(app).patch('/api/student/class-requests/cr1').send({ status: 'APPROVED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.decidedById).toBe('pm1');
  });

  it('cannot decide a request for a student outside their program', async () => {
    actor('PROGRAM_MANAGER', 'pm1');
    seedTable('studentProfile', [{ id: 'p2', userId: 's2', programManagerId: 'pm2' }]);
    seedTable('classChangeRequest', [{ id: 'cr2', studentId: 's2', classId: 'k1', action: 'DROP', status: 'PENDING' }]);

    const res = await request(app).patch('/api/student/class-requests/cr2').send({ status: 'APPROVED' });

    expect(res.status).toBe(404);
    expect(tables.classChangeRequest[0].status).toBe('PENDING');
  });
});
