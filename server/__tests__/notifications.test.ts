// Transactional email + scheduled reminders.
//
// The two properties under test are the ones that make retries safe:
//   * `dispatch` sends at most once per dedupe key, enforced by the ledger's
//     unique index rather than by in-process bookkeeping;
//   * an email failure is recorded and swallowed — it never propagates into the
//     request that triggered it, because a valid WSR submission must survive a
//     mail outage.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prismaMock, resetPrismaMock, resetStore, seedTable, tables } from './testDb.js';

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: () => ({ userId: null }),
  clerkClient: { users: { getUser: vi.fn(), getUserList: vi.fn(async () => ({ data: [] })) } },
}));

vi.mock('../prisma.js', () => ({ default: prismaMock, prisma: prismaMock }));

process.env.CLERK_SECRET_KEY = 'sk_test_stub';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_stub';

const { default: app } = await import('../app.js');
const { dispatch, setEmailProvider } = await import('../email/dispatcher.js');
const { reportReminder } = await import('../email/events.js');
const { renderHtml } = await import('../email/resendProvider.js');

/** Records every send instead of calling Resend. */
function fakeProvider(outcome: any = { status: 'SENT', providerMessageId: 'msg_1' }) {
  const sent: any[] = [];
  setEmailProvider({
    name: 'fake',
    async send(event) {
      sent.push(event);
      if (typeof outcome === 'function') return outcome(event);
      return outcome;
    },
  });
  return sent;
}

const cycle = { id: 'cy1', name: 'Week 12', endDate: new Date('2026-09-01T00:00:00Z') };
const recipient = { id: 's1', email: 's1@kspdominion.group', name: 'Student One' };

beforeEach(() => {
  resetPrismaMock();
  resetStore([]);
  delete process.env.CRON_SECRET;
  process.env.APP_BASE_URL = 'https://echotrack.example';
  fakeProvider();
});

// ── 1. Deduplication ───────────────────────────────────────────────────────

describe('dispatch deduplication', () => {
  it('sends once for a given dedupe key', async () => {
    const sent = fakeProvider();
    const result = await dispatch(reportReminder(recipient, cycle));

    expect(result.status).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(tables.notificationDispatch).toHaveLength(1);
  });

  it('skips a second dispatch with the same key instead of re-sending', async () => {
    const sent = fakeProvider();

    await dispatch(reportReminder(recipient, cycle));
    const second = await dispatch(reportReminder(recipient, cycle));

    expect(second.status).toBe('SKIPPED');
    expect(second.reason).toBe('already dispatched');
    expect(sent).toHaveLength(1); // still one — the ledger blocked the repeat
    expect(tables.notificationDispatch).toHaveLength(1);
  });

  it('keys reminders per cycle, so a new cycle sends again', async () => {
    const sent = fakeProvider();

    await dispatch(reportReminder(recipient, cycle));
    await dispatch(reportReminder(recipient, { ...cycle, id: 'cy2', name: 'Week 13' }));

    expect(sent).toHaveLength(2);
  });
});

// ── 2. Failure isolation ───────────────────────────────────────────────────

describe('dispatch failure handling', () => {
  it('records a provider failure without throwing', async () => {
    fakeProvider({ status: 'FAILED', error: 'Resend responded 500' });

    const result = await dispatch(reportReminder(recipient, cycle));

    expect(result.status).toBe('FAILED');
    expect(tables.notificationDispatch[0].status).toBe('FAILED');
    expect(tables.notificationDispatch[0].error).toMatch(/500/);
  });

  it('does not throw when the provider itself throws', async () => {
    setEmailProvider({
      name: 'exploding',
      async send() {
        throw new Error('socket hang up');
      },
    });

    await expect(dispatch(reportReminder(recipient, cycle))).resolves.toMatchObject({ status: 'FAILED' });
    expect(tables.notificationDispatch[0].error).toMatch(/socket hang up/);
  });

  it('skips a recipient with no email address', async () => {
    const sent = fakeProvider();
    const result = await dispatch(reportReminder({ id: 's1', email: '', name: 'No Email' }, cycle));

    expect(result.status).toBe('SKIPPED');
    expect(sent).toHaveLength(0);
  });
});

// ── 3. Rendering ───────────────────────────────────────────────────────────

describe('html rendering', () => {
  it('escapes content rather than interpolating it raw', () => {
    const html = renderHtml({
      type: 'REPORT_REMINDER',
      to: recipient,
      dedupeKey: 'k',
      subject: 's',
      body: 'Hello <script>alert(1)</script>',
    });

    expect(html).not.toMatch(/<script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });

  it('builds an absolute action link from APP_BASE_URL', () => {
    const event = reportReminder(recipient, cycle);
    expect(event.actionUrl).toBe('https://echotrack.example/student/report');
  });
});

// ── 4. Cron endpoint ───────────────────────────────────────────────────────

describe('cron endpoint', () => {
  it('returns 503 when CRON_SECRET is not configured', async () => {
    const res = await request(app).get('/api/cron/report-reminders');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('CRON_NOT_CONFIGURED');
  });

  it('rejects a missing or wrong secret with 401', async () => {
    process.env.CRON_SECRET = 'topsecret';

    const missing = await request(app).get('/api/cron/report-reminders');
    expect(missing.status).toBe(401);

    const wrong = await request(app)
      .get('/api/cron/report-reminders')
      .set('authorization', 'Bearer nope');
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('CRON_UNAUTHORIZED');
  });

  it('is not reachable with a user session instead of the secret', async () => {
    process.env.CRON_SECRET = 'topsecret';
    const res = await request(app).post('/api/cron/report-reminders').send({ run: true });
    expect(res.status).toBe(401);
  });

  it('reminds only students who have not submitted', async () => {
    process.env.CRON_SECRET = 'topsecret';
    const sent = fakeProvider();

    seedTable('reportCycle', [
      { id: 'cy1', name: 'Week 12', endDate: new Date(Date.now() + 86_400_000), status: 'OPEN', pathwayId: null },
    ]);
    resetStore([
      { id: 's1', email: 's1@kspdominion.group', role: 'STUDENT' },
      { id: 's2', email: 's2@kspdominion.group', role: 'STUDENT' },
    ]);
    // s2 already submitted; only s1 should be reminded.
    seedTable('weeklyReport', [{ id: 'r2', studentId: 's2', cycleId: 'cy1', status: 'SUBMITTED' }]);

    const res = await request(app)
      .get('/api/cron/report-reminders')
      .set('authorization', 'Bearer topsecret');

    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to.email).toBe('s1@kspdominion.group');
  });

  it('is idempotent — a second run in the same cycle sends nothing new', async () => {
    process.env.CRON_SECRET = 'topsecret';
    const sent = fakeProvider();

    seedTable('reportCycle', [
      { id: 'cy1', name: 'Week 12', endDate: new Date(Date.now() + 86_400_000), status: 'OPEN', pathwayId: null },
    ]);
    resetStore([{ id: 's1', email: 's1@kspdominion.group', role: 'STUDENT' }]);

    const first = await request(app).get('/api/cron/report-reminders').set('authorization', 'Bearer topsecret');
    const second = await request(app).get('/api/cron/report-reminders').set('authorization', 'Bearer topsecret');

    expect(first.body.sent).toBe(1);
    expect(second.body.sent).toBe(0);
    expect(second.body.skipped).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('ignores cycles that are closed or past their deadline', async () => {
    process.env.CRON_SECRET = 'topsecret';
    const sent = fakeProvider();

    seedTable('reportCycle', [
      { id: 'closed', name: 'Week 10', endDate: new Date(Date.now() + 86_400_000), status: 'CLOSED', pathwayId: null },
      { id: 'past', name: 'Week 11', endDate: new Date(Date.now() - 86_400_000), status: 'OPEN', pathwayId: null },
    ]);
    resetStore([{ id: 's1', email: 's1@kspdominion.group', role: 'STUDENT' }]);

    const res = await request(app).get('/api/cron/report-reminders').set('authorization', 'Bearer topsecret');

    expect(res.body.cyclesChecked).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
