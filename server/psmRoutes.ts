import { Router } from 'express';
import { authMiddleware, AuthRequest, roleMiddleware } from './auth.js';
import prisma from './prisma.js';
import { STUDENT_LEVEL } from '../shared/roles.js';
import { PHASES } from '../shared/phases.js';
import { loadRoutingProfile, routingFor, servesStudent } from './phaseRouting.js';

/**
 * The Placement Success Manager surface, and the Phase 2 timesheet flow.
 *
 * This is a separate view from /coach even for someone who holds both jobs:
 * the coach routes are scoped by StudentProfile.coachId and these by
 * StudentProfile.psmId, so a dual-hatted person sees their coached students in
 * one place and the students they placed in the other, and never a caseload
 * they were not assigned.
 */
const router = Router();

// Both roles may open either surface; the queries below scope by psmId, so a
// coach with no placements simply sees an empty queue.
const psmAccess = roleMiddleware(['PSM', 'COACH']);

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function fail(res: any, e: any, fallback: string) {
  res.status(e.status || 500).json({ error: e.status ? e.message : fallback });
}

/* ─────────────────────────────── PSM caseload ─────────────────────────────── */

router.get('/psm/students', authMiddleware, psmAccess, async (req: AuthRequest, res) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: { in: STUDENT_LEVEL }, isActive: true, studentProfile: { psmId: req.user.id } },
      select: {
        id: true, name: true, email: true,
        studentProfile: {
          select: {
            phone: true,
            coach: { select: { id: true, name: true } },
            programManager: { select: { id: true, name: true } },
            pathway: { select: { id: true, name: true } },
            community: {
              select: { id: true, name: true, cohort: { select: { id: true, name: true, startDate: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      students: students.map((student: any) => ({
        id: student.id,
        name: student.name,
        email: student.email,
        coach: student.studentProfile?.coach ?? null,
        programManager: student.studentProfile?.programManager ?? null,
        pathway: student.studentProfile?.pathway ?? null,
        community: student.studentProfile?.community
          ? { id: student.studentProfile.community.id, name: student.studentProfile.community.name }
          : null,
        cohort: student.studentProfile?.community?.cohort
          ? {
              id: student.studentProfile.community.cohort.id,
              name: student.studentProfile.community.cohort.name,
            }
          : null,
        phase: routingFor(student.studentProfile).phase,
      })),
    });
  } catch (e: any) {
    fail(res, e, 'Failed to load your students');
  }
});

/** Weekly status reports routed to this PSM (Phase 2). */
router.get('/psm/reports', authMiddleware, psmAccess, async (req: AuthRequest, res) => {
  try {
    const reports = await prisma.weeklyReport.findMany({
      where: {
        status: { in: ['SUBMITTED', 'REVIEWED'] },
        OR: [
          { recipientId: req.user.id },
          // Reports filed before the student had a PSM assigned.
          { student: { studentProfile: { psmId: req.user.id } }, phase: PHASES.PHASE_2 },
        ],
      },
      select: {
        id: true, status: true, submittedAt: true, phase: true,
        needsSupport: true, attendance: true,
        student: { select: { id: true, name: true, email: true } },
        cycle: { select: { id: true, name: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    res.json({ reports });
  } catch (e: any) {
    fail(res, e, 'Failed to load reports');
  }
});

router.get('/psm/dashboard', authMiddleware, psmAccess, async (req: AuthRequest, res) => {
  try {
    const [studentCount, pendingTimesheets, submittedReports] = await Promise.all([
      prisma.user.count({
        where: { role: { in: STUDENT_LEVEL }, isActive: true, studentProfile: { psmId: req.user.id } },
      }),
      prisma.timesheet.count({ where: { recipientId: req.user.id, status: 'SUBMITTED' } }),
      prisma.weeklyReport.count({ where: { recipientId: req.user.id, status: 'SUBMITTED' } }),
    ]);
    res.json({ studentCount, pendingTimesheets, submittedReports });
  } catch (e: any) {
    fail(res, e, 'Failed to load your dashboard');
  }
});

/* ────────────────────────────── timesheet queue ───────────────────────────── */

const TIMESHEET_SELECT = {
  id: true, status: true, totalHours: true, notes: true, submittedAt: true,
  reviewedAt: true, reviewNote: true,
  entries: { select: { id: true, workDate: true, hours: true, description: true }, orderBy: { workDate: 'asc' as const } },
  cycle: { select: { id: true, name: true } },
  student: { select: { id: true, name: true, email: true } },
  recipient: { select: { id: true, name: true } },
};

router.get('/psm/timesheets', authMiddleware, psmAccess, async (req: AuthRequest, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const timesheets = await prisma.timesheet.findMany({
      where: {
        status: status ? status : { not: 'DRAFT' },
        OR: [
          { recipientId: req.user.id },
          { student: { studentProfile: { psmId: req.user.id } } },
        ],
      },
      select: TIMESHEET_SELECT,
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    res.json({ timesheets });
  } catch (e: any) {
    fail(res, e, 'Failed to load timesheets');
  }
});

router.post('/psm/timesheets/:id/review', authMiddleware, psmAccess, async (req: AuthRequest, res) => {
  try {
    const decision = String(req.body?.decision || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      throw httpError(400, 'decision must be APPROVED or REJECTED');
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) : null;

    const timesheet = await prisma.timesheet.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, status: true, studentId: true,
        student: { select: { studentProfile: { select: { coachId: true, psmId: true, programManagerId: true } } } },
      },
    });
    if (!timesheet) throw httpError(404, 'Timesheet not found');
    if (!servesStudent(req.user, timesheet.student?.studentProfile ?? null)) {
      throw httpError(403, 'This timesheet is not assigned to you');
    }
    if (timesheet.status === 'DRAFT') throw httpError(400, 'This timesheet has not been submitted yet');

    await prisma.timesheet.update({
      where: { id: timesheet.id },
      data: {
        status: decision,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id, actorRole: req.user.role, action: 'REVIEW',
        entityType: 'Timesheet', entityId: timesheet.id,
        description: `Timesheet ${decision.toLowerCase()}`,
      },
    });

    res.json({ success: true });
  } catch (e: any) {
    fail(res, e, 'Failed to review this timesheet');
  }
});

/* ───────────────────────────── student timesheet ──────────────────────────── */

/** The student's timesheet for the open cycle, plus who it routes to. */
router.get('/student/timesheet', authMiddleware, roleMiddleware(['STUDENT']), async (req: AuthRequest, res) => {
  try {
    const profile = await loadRoutingProfile(req.user.id);
    if (!profile) throw httpError(400, 'Student profile not found');
    const routing = routingFor(profile);

    const cycle = await prisma.reportCycle.findFirst({
      where: { status: 'OPEN', OR: [{ pathwayId: profile.pathwayId }, { pathwayId: null }] },
      orderBy: { createdAt: 'desc' },
    });

    const timesheet = cycle
      ? await prisma.timesheet.findUnique({
          where: { studentId_cycleId: { studentId: req.user.id, cycleId: cycle.id } },
          select: TIMESHEET_SELECT,
        })
      : null;

    res.json({
      phase: routing.phase,
      required: routing.phase === PHASES.PHASE_2,
      recipient: routing.recipientRole === 'PSM' ? (profile as any).psm : null,
      missingRecipient: routing.missingRecipient,
      cycle: cycle ? { id: cycle.id, name: cycle.name } : null,
      timesheet,
    });
  } catch (e: any) {
    fail(res, e, 'Failed to load your timesheet');
  }
});

/** Save a draft or submit the timesheet. Entries replace the previous set. */
router.post('/student/timesheet', authMiddleware, roleMiddleware(['STUDENT']), async (req: AuthRequest, res) => {
  try {
    const status = String(req.body?.status || 'DRAFT').toUpperCase();
    if (!['DRAFT', 'SUBMITTED'].includes(status)) {
      throw httpError(400, 'status must be DRAFT or SUBMITTED');
    }

    const profile = await loadRoutingProfile(req.user.id);
    if (!profile) throw httpError(400, 'Student profile not found');
    const routing = routingFor(profile);
    if (routing.phase !== PHASES.PHASE_2) {
      throw httpError(400, 'Timesheets are submitted during Phase 2 (Corporate Internship) only.');
    }

    const cycle = await prisma.reportCycle.findFirst({
      where: { status: 'OPEN', OR: [{ pathwayId: profile.pathwayId }, { pathwayId: null }] },
      orderBy: { createdAt: 'desc' },
    });
    if (!cycle) throw httpError(400, 'No open report cycle is available.');

    const rawEntries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (rawEntries.length > 31) throw httpError(400, 'A timesheet can hold at most 31 entries');

    const entries = rawEntries.map((entry: any, index: number) => {
      const workDate = new Date(String(entry?.workDate || '').slice(0, 10) + 'T00:00:00.000Z');
      if (Number.isNaN(workDate.getTime())) throw httpError(400, `Entry ${index + 1} needs a valid date`);
      const hours = Number(entry?.hours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
        throw httpError(400, `Entry ${index + 1} needs hours between 0 and 24`);
      }
      const description = typeof entry?.description === 'string'
        ? entry.description.trim().slice(0, 500) || null
        : null;
      return { workDate, hours: Math.round(hours * 100) / 100, description };
    });

    if (status === 'SUBMITTED' && entries.length === 0) {
      throw httpError(400, 'Add at least one entry before submitting.');
    }

    const existing = await prisma.timesheet.findUnique({
      where: { studentId_cycleId: { studentId: req.user.id, cycleId: cycle.id } },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      throw httpError(409, 'This timesheet has already been submitted.');
    }

    const totalHours = Math.round(entries.reduce((sum, e) => sum + e.hours, 0) * 100) / 100;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 2000) || null : null;

    const shared = {
      status,
      totalHours,
      notes,
      submittedAt: status === 'SUBMITTED' ? new Date() : null,
      recipientId: routing.recipientId,
      // A resubmission clears the previous decision.
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    };

    const timesheet = await prisma.$transaction(async (tx) => {
      const saved = await tx.timesheet.upsert({
        where: { studentId_cycleId: { studentId: req.user.id, cycleId: cycle.id } },
        update: shared,
        create: { studentId: req.user.id, cycleId: cycle.id, ...shared },
        select: { id: true },
      });
      await tx.timesheetEntry.deleteMany({ where: { timesheetId: saved.id } });
      if (entries.length) {
        await tx.timesheetEntry.createMany({
          data: entries.map((entry) => ({ ...entry, timesheetId: saved.id })),
        });
      }
      return saved;
    });

    res.json({
      success: true,
      timesheet: await prisma.timesheet.findUnique({ where: { id: timesheet.id }, select: TIMESHEET_SELECT }),
    });
  } catch (e: any) {
    fail(res, e, 'Failed to save your timesheet');
  }
});

export default router;
