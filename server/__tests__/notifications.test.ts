// Transactional email + scheduled reminders.
//
// The properties under test are the ones that make retries safe:
//   * a confirmed SENT event is terminal for its application dedupe key;
//   * transient/ambiguous provider failures may retry only while provider
//     idempotency can still protect the send;
//   * a no-op caused by missing mail configuration may retry later because no
//     provider request was made;
//   * an email failure is recorded and swallowed — it never invalidates the
//     request that triggered it.

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
const { renderHtml, ResendEmailProvider, resendIdempotencyKey } = await import('../email/resendProvider.js');

/** Records every provider call instead of calling Resend. */
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
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_REPLY_TO;
  process.env.APP_BASE_URL = 'https://echotrack.example';
  fakeProvider();
});

// ── 1. Deduplication + retry semantics ─────────────────────────────────────

describe('dispatch deduplication', () => {
  it('sends once for a given dedupe key', async () => {
    const sent = fakeProvider();
    const result = await dispatch(reportReminder(recipient, cycle));

    expect(result.status).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(tables.notificationDispatch).toHaveLength(1);
    expect(tables.notificationDispatch[0].attempts).toBe(1);
  });

  it('skips a second dispatch after a confirmed send', async () => {
    const sent = fakeProvider();

    await dispatch(reportReminder(recipient, cycle));
    const second = await dispatch(reportReminder(recipient, cycle));

    expect(second.status).toBe('SKIPPED');
    expect(second.reason).toBe('already dispatched');
    expect(sent).toHaveLength(1);
    expect(tables.notificationDispatch).toHaveLength(1);
  });

  it('keys reminders per cycle, so a new cycle sends again', async () => {
    const sent = fakeProvider();

    await dispatch(reportReminder(recipient, cycle));
    await dispatch(reportReminder(recipient, { ...cycle, id: 'cy2', name: 'Week 13' }));

    expect(sent).toHaveLength(2);
  });

  it('retries a transient provider failure inside the provider idempotency window', async () => {
    let calls = 0;
    const sent = fakeProvider(() => {
      calls += 1;
      return calls === 1
        ? { status: 'FAILED', error: 'temporary provider failure', retryable: true, providerAttempted: true }
        : { status: 'SENT', providerMessageId: 'msg_retry' };
    });

    const first = await dispatch(reportReminder(recipient, cycle));
    const second = await dispatch(reportReminder(recipient, cycle));

    expect(first.status).toBe('FAILED');
    expect(second.status).toBe('SENT');
    expect(sent).toHaveLength(2);
    expect(tables.notificationDispatch).toHaveLength(1);
    expect(tables.notificationDispatch[0].attempts).toBe(2);
    expect(tables.notificationDispatch[0].status).toBe('SENT');
  });

  it('does not retry a provider failure classified as non-retryable', async () => {
    const sent = fakeProvider({
      status: 'FAILED',
      error: 'Resend responded 422',
      retryable: false,
      providerAttempted: true,
    });

    const first = await dispatch(reportReminder(recipient, cycle));
    const second = await dispatch(reportReminder(recipient, cycle));

    expect(first.status).toBe('FAILED');
    expect(second.status).toBe('SKIPPED');
    expect(second.reason).toBe('previous attempt is not retryable');
    expect(sent).toHaveLength(1);
  });

  it('retries a configuration skip later because no provider request occurred', async () => {
    fakeProvider({
      status: 'SKIPPED',
      reason: 'mail provider is not configured',
      retryable: true,
      providerAttempted: false,
    });

    const first = await dispatch(reportReminder(recipient, cycle));
    expect(first.status).toBe('SKIPPED');

    const sent = fakeProvider({ status: 'SENT', providerMessageId: 'msg_after_config' });
    const second = await dispatch(reportReminder(recipient, cycle));

    expect(second.status).toBe('SENT');
    expect(sent).toHaveLength(1);
    expect(tables.notificationDispatch[0].attempts).toBe(2);
  });

  it('refuses an ambiguous retry after the provider idempotency window', async () => {
    const event = reportReminder(recipient, cycle);
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    seedTable('notificationDispatch', [
      {
        id: 'dispatch-stale',
        dedupeKey: event.dedupeKey,
        eventType: event.type,
        recipientEmail: recipient.email,
        status: 'PENDING',
        attempts: 1,
        payload: JSON.stringify({ retryable: true, providerAttempted: true }),
        createdAt: stale,
        updatedAt: stale,
      },
    ]);
    const sent = fakeProvider();

    const result = await dispatch(event);

    expect(result.status).toBe('SKIPPED');
    expect(result.reason).toMatch(/reconciliation required/);
    expect(sent).toHaveLength(0);
  });
});

// ── 2. Failure isolation ───────────────────────────────────────────────────

describe('dispatch failure handling', () => {
  it('records a provider failure without throwing', async () => {
    fakeProvider({ status: 'FAILED', error: 'Resend responded 500', retryable: true, providerAttempted: true });

    const result = await dispatch(reportReminder(recipient, cycle));

    expect(result.status).toBe('FAILED');
    expect(tables.notificationDispatch[0].status).toBe('FAILED');
    expect(tables.notificationDispatch[0].error).toMatch(/500/);
  });

  it('does not throw or persist the provider exception text when the provider itself throws', async () => {
    setEmailProvider({
      name: 'exploding',
      async send() {
        throw new Error('socket hang up for s1@kspdominion.group');
      },
    });

    await expect(dispatch(reportReminder(recipient, cycle))).resolves.toMatchObject({ status: 'FAILED' });
    expect(tables.notificationDispatch[0].error).toBe('email provider threw before a definitive response');
    expect(tables.notificationDispatch[0].error).not.toContain(recipient.email);
  });

  it('skips a recipient with no email address', async () => {
    const sent = fakeProvider();
    const result = await dispatch(reportReminder({ id: 's1', email: '', name: 'No Email' }, cycle));

    expect(result.status).toBe('SKIPPED');
    expect(sent).toHaveLength(0);
  });
});

// ── 3. Resend adapter + rendering ──────────────────────────────────────────

describe('Resend adapter', () => {
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

  it('sends a deterministic provider idempotency key instead of the raw event key', async () => {
    process.env.RESEND_API_KEY = 're_test_stub';
    process.env.EMAIL_FROM = 'EchoTrack <no-reply@example.com>';
    const event = reportReminder(recipient, cycle);
    const fetchMock = vi.fn(async (_url: any, _init: any) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg_resend' }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    try {
      const outcome = await new ResendEmailProvider().send(event);
      expect(outcome).toMatchObject({ status: 'SENT', providerMessageId: 'msg_resend' });
      const init = fetchMock.mock.calls[0][1] as any;
      const key = init.headers['Idempotency-Key'];
      expect(key).toBe(resendIdempotencyKey(event));
      expect(key).toMatch(/^echotrack\/[a-f0-9]{64}$/);
      expect(key).not.toContain(event.dedupeKey);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not persist raw Resend error bodies that may contain recipient PII', async () => {
    process.env.RESEND_API_KEY = 're_test_stub';
    process.env.EMAIL_FROM = 'EchoTrack <no-reply@example.com>';
    const fetchMock = vi.fn(async (_url: any, _init: any) => ({
      ok: false,
      status: 500,
      json: async () => null,
      text: async () => JSON.stringify({ name: 'internal_server_error', message: `failed for ${recipient.email}` }),
    }));
    vi.stubGlobal('fetch', fetchMock as any);

    try {
      const outcome = await new ResendEmailProvider().send(reportReminder(recipient, cycle));
      expect(outcome).toMatchObject({ status: 'FAILED', retryable: true, providerAttempted: true });
      if (outcome.status === 'FAILED') {
        expect(outcome.error).toBe('Resend responded 500 (internal_server_error)');
        expect(outcome.error).not.toContain(recipient.email);
      }
    } finally {
      vi.unstubAllGlobals();
    }
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
