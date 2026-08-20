import { Router } from 'express';
import { authMiddleware, AuthRequest, roleMiddleware } from './auth.js';
import prisma from './prisma.js';
import { STUDENT_LEVEL } from '../shared/roles.js';
import { routingFor } from './phaseRouting.js';

/**
 * Cohort administration and placement assignment.
 *
 * Without these the phase machinery is inert: nothing else in the app creates a
 * Cohort, sets Community.cohortId, or writes StudentProfile.psmId, so every
 * student would sit in Phase 1 forever with no PSM and the Phase 2 report and
 * timesheet flow would be unreachable.
 */
const router = Router();

const MANAGERS = ['ADMIN', 'PROGRAM_MANAGER'];

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function fail(res: any, e: any, fallback: string) {
  res.status(e.status || 500).json({ error: e.status ? e.message : fallback });
}

function text(value: unknown, field: string, max: number, required = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw httpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed && required) throw httpError(400, `${field} is required`);
  if (trimmed.length > max) throw httpError(400, `${field} is too long`);
  return trimmed || null;
}

/** Accepts "YYYY-MM-DD" and normalises to midnight UTC so phase maths is stable. */
function date(value: unknown, field: string): Date | null {
  const raw = text(value, field, 32, false);
  if (!raw) return null;
  const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(parsed.getTime())) throw httpError(400, `${field} must be a valid date`);
  return parsed;
}

/* ──────────────────────────────── cohorts ──────────────────────────────── */

router.get('/admin/cohorts', authMiddleware, roleMiddleware(MANAGERS), async (_req: AuthRequest, res) => {
  try {
    const cohorts = await prisma.cohort.findMany({
      select: {
        id: true, name: true, startDate: true, endDate: true, isActive: true,
        communities: {
          select: {
            id: true, name: true,
            programManager: { select: { id: true, name: true } },
            _count: { select: { studentProfiles: true } },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
    });

    // Learning communities not yet attached to any cohort, so an admin can see
    // exactly what still needs assigning.
    const unassigned = await prisma.community.findMany({
      where: { cohortId: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    res.json({
      cohorts: cohorts.map((cohort: any) => ({
        ...cohort,
        // The phase every student in this cohort is currently in.
        phase: routingFor({ community: { cohort } }).phase,
      })),
      unassignedCommunities: unassigned,
    });
  } catch (e: any) {
    fail(res, e, 'Failed to load cohorts');
  }
});

router.post('/admin/cohorts', authMiddleware, roleMiddleware(MANAGERS), async (req: AuthRequest, res) => {
  try {
    const cohort = await prisma.cohort.create({
      data: {
        name: text(req.body?.name, 'name', 120)!,
        startDate: date(req.body?.startDate, 'startDate'),
        endDate: date(req.body?.endDate, 'endDate'),
      },
      select: { id: true, name: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id, actorRole: req.user.role, action: 'CREATE',
        entityType: 'Cohort', entityId: cohort.id, description: `Created cohort ${cohort.name}`,
      },
    });

    res.json({ cohort });
  } catch (e: any) {
    fail(res, e, 'Failed to create this cohort');
  }
});

router.patch('/admin/cohorts/:id', authMiddleware, roleMiddleware(MANAGERS), async (req: AuthRequest, res) => {
  try {
    const data: Record<string, unknown> = {};
    if ('name' in (req.body ?? {})) data.name = text(req.body.name, 'name', 120)!;
    if ('startDate' in (req.body ?? {})) data.startDate = date(req.body.startDate, 'startDate');
    if ('endDate' in (req.body ?? {})) data.endDate = date(req.body.endDate, 'endDate');
    if ('isActive' in (req.body ?? {})) data.isActive = Boolean(req.body.isActive);

    await prisma.cohort.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (e: any) {
    fail(res, e, 'Failed to update this cohort');
  }
});

/**
 * Attach or detach a learning community. A cohort runs two learning
 * communities per cycle, so adding a third is refused rather than silently
 * breaking the "sibling LC" the directory depends on.
 */
router.patch('/admin/communities/:id/cohort', authMiddleware, roleMiddleware(MANAGERS), async (req: AuthRequest, res) => {
  try {
    const cohortId = text(req.body?.cohortId, 'cohortId', 64, false);

    if (cohortId) {
      const cohort = await prisma.cohort.findUnique({
        where: { id: cohortId },
        select: { id: true, name: true, _count: { select: { communities: true } } },
      });
      if (!cohort) throw httpError(404, 'Cohort not found');

      const already = await prisma.community.findFirst({
        where: { id: req.params.id, cohortId },
        select: { id: true },
      });
      if (!already && cohort._count.communities >= 2) {
        throw httpError(
          400,
          `${cohort.name} already runs two learning communities. Detach one before adding another.`,
        );
      }
    }

    await prisma.community.update({
      where: { id: req.params.id },
      data: { cohortId },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id, actorRole: req.user.role, action: 'UPDATE',
        entityType: 'Community', entityId: req.params.id,
        description: cohortId ? `Assigned to cohort ${cohortId}` : 'Detached from its cohort',
      },
    });

    res.json({ success: true });
  } catch (e: any) {
    fail(res, e, 'Failed to update this learning community');
  }
});

/* ─────────────────────────── placement assignment ─────────────────────────── */

/** Students in a cohort (or all of them), with their current PSM. */
router.get('/admin/placements', authMiddleware, roleMiddleware(MANAGERS), async (req: AuthRequest, res) => {
  try {
    const cohortId = typeof req.query.cohortId === 'string' ? req.query.cohortId : null;
    const isPm = req.user.role === 'PROGRAM_MANAGER';

    const students = await prisma.user.findMany({
      where: {
        role: { in: STUDENT_LEVEL },
        isActive: true,
        studentProfile: {
          ...(cohortId ? { community: { cohortId } } : {}),
          // Program managers only place their own students.
          ...(isPm ? { programManagerId: req.user.id } : {}),
        },
      },
      select: {
        id: true, name: true, email: true,
        studentProfile: {
          select: {
            psm: { select: { id: true, name: true } },
            coach: { select: { id: true, name: true } },
            community: {
              select: { id: true, name: true, cohort: { select: { id: true, name: true, startDate: true } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });

    // Anyone who can hold a placement caseload.
    const psms = await prisma.user.findMany({
      where: { role: { in: ['PSM', 'COACH'] }, isActive: true, accountStatus: 'ACTIVE' },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });

    res.json({
      psms,
      students: students.map((student: any) => ({
        id: student.id,
        name: student.name,
        email: student.email,
        psm: student.studentProfile?.psm ?? null,
        coach: student.studentProfile?.coach ?? null,
        community: student.studentProfile?.community
          ? { id: student.studentProfile.community.id, name: student.studentProfile.community.name }
          : null,
        phase: routingFor(student.studentProfile).phase,
      })),
    });
  } catch (e: any) {
    fail(res, e, 'Failed to load placements');
  }
});

router.patch('/admin/students/:studentId/psm', authMiddleware, roleMiddleware(MANAGERS), async (req: AuthRequest, res) => {
  try {
    const psmId = text(req.body?.psmId, 'psmId', 64, false);

    const profile = await prisma.studentProfile.findUnique({
      where: { userId: req.params.studentId },
      select: { id: true, programManagerId: true },
    });
    if (!profile) throw httpError(404, 'Student profile not found');
    if (req.user.role === 'PROGRAM_MANAGER' && profile.programManagerId !== req.user.id) {
      throw httpError(403, 'That student is not in your learning community');
    }

    if (psmId) {
      const psm = await prisma.user.findUnique({ where: { id: psmId }, select: { role: true, isActive: true } });
      // A PSM or a coach wearing the placement hat — nobody else.
      if (!psm || !psm.isActive || !['PSM', 'COACH'].includes(psm.role)) {
        throw httpError(400, 'That user cannot be assigned as a Placement Success Manager');
      }
    }

    await prisma.studentProfile.update({ where: { id: profile.id }, data: { psmId } });

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id, actorRole: req.user.role, action: 'UPDATE',
        entityType: 'StudentProfile', entityId: profile.id,
        description: psmId ? `Assigned PSM ${psmId}` : 'Cleared the assigned PSM',
      },
    });

    res.json({ success: true });
  } catch (e: any) {
    fail(res, e, 'Failed to assign the PSM');
  }
});

export default router;
