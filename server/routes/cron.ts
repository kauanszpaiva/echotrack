// Scheduled jobs, invoked by Vercel Cron.
//
// The AI Studio build used `node-cron`, which assumes a Node process that stays
// alive between requests. Serverless functions do not: the process is torn down
// after each invocation, so an in-process scheduler either never fires or fires
// unpredictably per warm instance. The schedule therefore lives in
// `vercel.json`, and this endpoint does the work for a single tick.
//
// Safe to call twice. The dedupe ledger in `server/email/dispatcher.ts` makes a
// retry a no-op rather than a second email.

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import prisma from '../prisma.js';
import { STUDENT_LEVEL } from '../../shared/roles.js';
import { dispatch } from '../email/dispatcher.js';
import { reportReminder } from '../email/events.js';

const router = Router();

/**
 * Cron authentication.
 *
 * This route is not behind Clerk — there is no user session on a scheduled
 * invocation. It is protected by a shared secret instead. Missing configuration
 * fails closed with 503; a wrong secret is 401.
 *
 * The comparison is length-checked before `timingSafeEqual`, which throws on
 * mismatched lengths.
 */
function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res.status(503).json({ code: 'CRON_NOT_CONFIGURED', error: 'Scheduled jobs are not configured' });
  }

  const header = req.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.secret ?? '');

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    return res.status(401).json({ code: 'CRON_UNAUTHORIZED', error: 'Unauthorized' });
  }
  next();
}

/**
 * Weekly report reminders.
 *
 * For every OPEN cycle whose deadline has not passed, find the students who have
 * no report or only a DRAFT, and send each of them one reminder per cycle.
 */
async function runReportReminders() {
  const now = new Date();

  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  // Honour the app-level switch: an org that closes cycles automatically does
  // not want reminders chasing a cycle that is about to close itself.
  const remindersEnabled = settings?.autoCloseCycles !== true;

  const openCycles = await prisma.reportCycle.findMany({
    where: { status: 'OPEN', endDate: { gte: now } },
    select: { id: true, name: true, endDate: true, pathwayId: true },
  });

  const summary = {
    cyclesChecked: openCycles.length,
    candidates: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    remindersEnabled,
  };

  if (!remindersEnabled || openCycles.length === 0) return summary;

  for (const cycle of openCycles) {
    const students = await prisma.user.findMany({
      where: {
        role: { in: STUDENT_LEVEL },
        isActive: true,
        accountStatus: 'ACTIVE',
        ...(cycle.pathwayId ? { studentProfile: { pathwayId: cycle.pathwayId } } : {}),
      },
      select: { id: true, email: true, name: true },
    });
    if (students.length === 0) continue;

    const submitted = await prisma.weeklyReport.findMany({
      where: { cycleId: cycle.id, status: 'SUBMITTED' },
      select: { studentId: true },
    });
    const done = new Set(submitted.map((r) => r.studentId));

    const outstanding = students.filter((s) => !done.has(s.id));
    summary.candidates += outstanding.length;

    for (const student of outstanding) {
      const result = await dispatch(reportReminder({ id: student.id, email: student.email, name: student.name }, cycle));
      if (result.status === 'SENT') summary.sent += 1;
      else if (result.status === 'SKIPPED') summary.skipped += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

async function handleReportReminders(_req: Request, res: Response, next: NextFunction) {
  try {
    const summary = await runReportReminders();
    res.json({ job: 'report-reminders', ranAt: new Date().toISOString(), ...summary });
  } catch (err) {
    next(err);
  }
}

// Vercel Cron issues GET; POST is accepted for manual operator invocation.
router.get('/report-reminders', requireCronSecret, handleReportReminders);
router.post('/report-reminders', requireCronSecret, handleReportReminders);

export { runReportReminders };
export default router;
