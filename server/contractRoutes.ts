import { Router } from 'express';
import { authMiddleware, AuthRequest, roleMiddleware } from './auth.js';
import prisma from './prisma.js';
import { isAdminLevel, STUDENT_LEVEL } from '../shared/roles.js';
import {
  contractStanding, isContractTrack, CONTRACT_TRACK_RULES,
  type ContractTrack, type StandingThresholds,
} from '../shared/contract.js';
import { servesStudent } from './phaseRouting.js';

/**
 * Performance Contract standing and EPIC plans.
 *
 * The point balance is always derived: opening pool + weeks met − APPROVED
 * infractions. Nothing stores a balance, so it can never drift from the conduct
 * record. Pending entries are excluded because they have not been upheld yet,
 * and CLEARED entries were reversed.
 */
const router = Router();

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function fail(res: any, e: any, fallback: string) {
  res.status(e.status || 500).json({ error: e.status ? e.message : fallback });
}

async function thresholds(): Promise<StandingThresholds> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { stipendPointThreshold: true, epicPointThreshold: true },
  });
  return {
    stipendThreshold: settings?.stipendPointThreshold ?? 150,
    epicThreshold: settings?.epicPointThreshold ?? 120,
  };
}

/** Sum of upheld deductions. Only APPROVED infractions count against a student. */
async function deductedPoints(studentId: string): Promise<number> {
  const result = await prisma.conductEntry.aggregate({
    where: { studentId, type: 'INFRACTION', status: 'APPROVED' },
    _sum: { points: true },
  });
  return result._sum.points ?? 0;
}

/**
 * A student's full standing. Returns null when no contract has been created —
 * the caller decides whether that is an error or just "not enrolled yet".
 */
async function standingFor(studentId: string) {
  const contract = await prisma.performanceContract.findUnique({
    where: { studentId },
    select: { id: true, track: true, weeksMet: true, status: true, signedAt: true },
  });
  if (!contract) return null;

  const track: ContractTrack = isContractTrack(contract.track) ? contract.track : 'BUSINESS';
  const [deducted, limits, openPlan] = await Promise.all([
    deductedPoints(studentId),
    thresholds(),
    prisma.epicPlan.findFirst({
      where: { studentId, status: 'OPEN' },
      select: { id: true, reason: true, expectations: true, reviewDate: true, createdAt: true },
    }),
  ]);

  // weeksMet is clamped so a track change to a shorter track cannot throw.
  const weeksMet = Math.min(contract.weeksMet, CONTRACT_TRACK_RULES[track].durationWeeks);

  return {
    contract: { id: contract.id, status: contract.status, signedAt: contract.signedAt },
    standing: contractStanding(track, weeksMet, deducted, limits),
    openEpicPlan: openPlan,
  };
}

/* ─────────────────────────────── student view ─────────────────────────────── */

router.get('/student/standing', authMiddleware, roleMiddleware(['STUDENT']), async (req: AuthRequest, res) => {
  try {
    const result = await standingFor(req.user.id);
    if (!result) return res.json({ enrolled: false });

    const infractions = await prisma.conductEntry.findMany({
      where: { studentId: req.user.id, type: 'INFRACTION', status: 'APPROVED' },
      select: { id: true, points: true, summary: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ enrolled: true, ...result, infractions });
  } catch (e: any) {
    fail(res, e, 'Failed to load your standing');
  }
});

/* ──────────────────────────────── staff view ─────────────────────────────── */

router.get('/students/:studentId/standing', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { studentId } = req.params;
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: studentId },
      select: { coachId: true, psmId: true, programManagerId: true },
    });
    if (!servesStudent(req.user, profile)) {
      throw httpError(403, 'This student is not assigned to you');
    }

    const result = await standingFor(studentId);
    if (!result) return res.json({ enrolled: false });
    res.json({ enrolled: true, ...result });
  } catch (e: any) {
    fail(res, e, 'Failed to load this standing');
  }
});

/** Everyone flagged for an EPIC plan, for the staff who serve them. */
router.get('/contracts/at-risk', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const admin = isAdminLevel(req.user.role);
    const contracts = await prisma.performanceContract.findMany({
      where: admin
        ? {}
        : {
            student: {
              studentProfile: {
                OR: [
                  { coachId: req.user.id },
                  { psmId: req.user.id },
                  { programManagerId: req.user.id },
                ],
              },
            },
          },
      select: {
        studentId: true, track: true, weeksMet: true, status: true,
        student: { select: { id: true, name: true, email: true } },
      },
      take: 500,
    });

    const limits = await thresholds();
    const rows = await Promise.all(
      contracts.map(async (contract: any) => {
        const track: ContractTrack = isContractTrack(contract.track) ? contract.track : 'BUSINESS';
        const weeksMet = Math.min(contract.weeksMet, CONTRACT_TRACK_RULES[track].durationWeeks);
        const standing = contractStanding(track, weeksMet, await deductedPoints(contract.studentId), limits);
        return { student: contract.student, contractStatus: contract.status, standing };
      }),
    );

    res.json({
      students: rows
        .filter((row) => row.standing.level !== 'GOOD')
        .sort((a, b) => a.standing.balance - b.standing.balance),
    });
  } catch (e: any) {
    fail(res, e, 'Failed to load at-risk students');
  }
});

/* ─────────────────────────── contract administration ─────────────────────── */

const CONTRACT_MANAGERS = ['ADMIN', 'PROGRAM_MANAGER'];

router.post('/contracts', authMiddleware, roleMiddleware(CONTRACT_MANAGERS), async (req: AuthRequest, res) => {
  try {
    const studentId = String(req.body?.studentId || '');
    const track = req.body?.track;
    if (!studentId) throw httpError(400, 'studentId is required');
    if (!isContractTrack(track)) {
      throw httpError(400, `track must be one of: ${Object.keys(CONTRACT_TRACK_RULES).join(', ')}`);
    }

    const student = await prisma.user.findUnique({ where: { id: studentId }, select: { role: true } });
    if (!student || !STUDENT_LEVEL.includes(student.role as any)) {
      throw httpError(400, 'That user is not a student');
    }

    const contract = await prisma.performanceContract.upsert({
      where: { studentId },
      update: { track },
      create: { studentId, track, signedAt: new Date() },
      select: { id: true, track: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id, actorRole: req.user.role, action: 'CREATE',
        entityType: 'PerformanceContract', entityId: contract.id,
        description: `Performance contract set to ${track}`,
      },
    });

    res.json({ contract });
  } catch (e: any) {
    fail(res, e, 'Failed to save this contract');
  }
});

/** Record the weeks a student met expectations, which is what earns points. */
router.patch('/contracts/:studentId/weeks-met', authMiddleware, roleMiddleware(CONTRACT_MANAGERS), async (req: AuthRequest, res) => {
  try {
    const weeksMet = Number(req.body?.weeksMet);
    if (!Number.isInteger(weeksMet) || weeksMet < 0) {
      throw httpError(400, 'weeksMet must be a whole number of 0 or more');
    }

    const contract = await prisma.performanceContract.findUnique({
      where: { studentId: req.params.studentId },
      select: { id: true, track: true },
    });
    if (!contract) throw httpError(404, 'This student has no performance contract');

    const track: ContractTrack = isContractTrack(contract.track) ? contract.track : 'BUSINESS';
    const maxWeeks = CONTRACT_TRACK_RULES[track].durationWeeks;
    if (weeksMet > maxWeeks) {
      throw httpError(400, `The ${CONTRACT_TRACK_RULES[track].label} track runs ${maxWeeks} weeks`);
    }

    await prisma.performanceContract.update({ where: { id: contract.id }, data: { weeksMet } });
    res.json({ success: true });
  } catch (e: any) {
    fail(res, e, 'Failed to update weeks met');
  }
});

/* ───────────────────────────────── EPIC plans ────────────────────────────── */

const EPIC_SELECT = {
  id: true, status: true, reason: true, expectations: true, balanceAtOpen: true,
  reviewDate: true, closedAt: true, outcomeNote: true, createdAt: true,
  student: { select: { id: true, name: true, email: true } },
  openedBy: { select: { id: true, name: true, role: true } },
  closedBy: { select: { id: true, name: true } },
};

router.get('/epic-plans', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const admin = isAdminLevel(req.user.role);
    const status = typeof req.query.status === 'string' ? req.query.status : null;

    const plans = await prisma.epicPlan.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(admin
          ? {}
          : {
              student: {
                studentProfile: {
                  OR: [
                    { coachId: req.user.id },
                    { psmId: req.user.id },
                    { programManagerId: req.user.id },
                  ],
                },
              },
            }),
      },
      select: EPIC_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ plans });
  } catch (e: any) {
    fail(res, e, 'Failed to load EPIC plans');
  }
});

/**
 * Open an EPIC plan. A PSM raising a Phase 2 workplace issue and a Program
 * Manager acting on a point balance both land here, which is why any staff
 * member who serves the student may open one.
 */
router.post('/epic-plans', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const studentId = String(req.body?.studentId || '');
    const reason = String(req.body?.reason || '').trim();
    const expectations = String(req.body?.expectations || '').trim();
    if (!studentId) throw httpError(400, 'studentId is required');
    if (!reason) throw httpError(400, 'reason is required');
    if (!expectations) throw httpError(400, 'expectations is required');

    const profile = await prisma.studentProfile.findUnique({
      where: { userId: studentId },
      select: { coachId: true, psmId: true, programManagerId: true },
    });
    if (!servesStudent(req.user, profile)) {
      throw httpError(403, 'This student is not assigned to you');
    }

    const existing = await prisma.epicPlan.findFirst({
      where: { studentId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) throw httpError(409, 'This student already has an open EPIC plan');

    const reviewDate = req.body?.reviewDate ? new Date(String(req.body.reviewDate)) : null;
    if (reviewDate && Number.isNaN(reviewDate.getTime())) {
      throw httpError(400, 'reviewDate must be a valid date');
    }

    const current = await standingFor(studentId);

    const plan = await prisma.epicPlan.create({
      data: {
        studentId,
        openedById: req.user.id,
        reason: reason.slice(0, 2000),
        expectations: expectations.slice(0, 4000),
        balanceAtOpen: current?.standing.balance ?? null,
        reviewDate,
      },
      select: EPIC_SELECT,
    });

    // Mirror the plan onto the contract so the student's status reads EPIC.
    await prisma.performanceContract.updateMany({
      where: { studentId, status: 'ACTIVE' },
      data: { status: 'EPIC' },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id, actorRole: req.user.role, action: 'CREATE',
        entityType: 'EpicPlan', entityId: plan.id,
        description: `Opened EPIC plan (balance ${current?.standing.balance ?? 'unknown'})`,
      },
    });

    res.json({ plan });
  } catch (e: any) {
    fail(res, e, 'Failed to open this EPIC plan');
  }
});

router.post('/epic-plans/:id/close', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const outcome = String(req.body?.outcome || '').toUpperCase();
    if (!['MET', 'NOT_MET', 'CANCELLED'].includes(outcome)) {
      throw httpError(400, 'outcome must be MET, NOT_MET or CANCELLED');
    }

    const plan = await prisma.epicPlan.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, status: true, studentId: true,
        student: { select: { studentProfile: { select: { coachId: true, psmId: true, programManagerId: true } } } },
      },
    });
    if (!plan) throw httpError(404, 'EPIC plan not found');
    if (!servesStudent(req.user, plan.student?.studentProfile ?? null)) {
      throw httpError(403, 'This student is not assigned to you');
    }
    if (plan.status !== 'OPEN') throw httpError(400, 'This plan is already closed');

    await prisma.epicPlan.update({
      where: { id: plan.id },
      data: {
        status: outcome,
        closedById: req.user.id,
        closedAt: new Date(),
        outcomeNote: typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 2000) || null : null,
      },
    });

    // Meeting the plan (or cancelling it) restores the student to active standing.
    if (outcome !== 'NOT_MET') {
      await prisma.performanceContract.updateMany({
        where: { studentId: plan.studentId, status: 'EPIC' },
        data: { status: 'ACTIVE' },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: req.user.id, actorRole: req.user.role, action: 'REVIEW',
        entityType: 'EpicPlan', entityId: plan.id,
        description: `Closed EPIC plan as ${outcome}`,
      },
    });

    res.json({ success: true });
  } catch (e: any) {
    fail(res, e, 'Failed to close this EPIC plan');
  }
});

export default router;
