// Student engagement domain — daily check-ins, weekly goals, personal
// templates, coaching goals, report annotations and class-change requests.
//
// Ported from the AI Studio export, where these routes lived in the 3762-line
// `server/routes.ts` and authorized on role alone. Here every student-scoped
// read and write goes through `assertStudentScope`, so changing an id in the
// URL is not enough to reach another student's record.

import { Router } from 'express';
import prisma from '../prisma.js';
import { authMiddleware, roleMiddleware, type AuthRequest } from '../auth.js';
import { isStudentLevel } from '../../shared/roles.js';
import { assertStudentScope, canAccessStudent, notFound } from '../authorization/scopes.js';
import { httpError } from './helpers.js';
import {
  annotationSchema,
  classChangeRequestSchema,
  coachingGoalSchema,
  dailyCheckInSchema,
  decideClassChangeSchema,
  studentTemplateSchema,
  updateCoachingGoalSchema,
  updateWeeklyGoalSchema,
  weeklyGoalSchema,
} from '../schemas.js';

const router = Router();

/** Wraps an async handler so a thrown httpError reaches the JSON error handler. */
function handle(fn: (req: AuthRequest, res: any) => Promise<any>) {
  return (req: any, res: any, next: any) => fn(req, res).catch(next);
}

function bad(message: string) {
  return httpError(400, message);
}

/**
 * Resolve which student a staff request is about.
 *
 * A student always operates on themselves — a `studentId` in their query string
 * is ignored rather than honoured, so it cannot be used to widen scope.
 */
async function resolveStudentId(req: AuthRequest): Promise<string> {
  const actor = req.user!;
  if (isStudentLevel(actor.role)) return actor.id;

  const requested = typeof req.query.studentId === 'string' ? req.query.studentId : null;
  if (!requested) throw bad('studentId is required');
  await assertStudentScope(actor, requested);
  return requested;
}

function pagination(req: AuthRequest) {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 30;
  const rawSkip = Number(req.query.skip);
  const skip = Number.isInteger(rawSkip) && rawSkip > 0 ? rawSkip : 0;
  return { take: limit, skip };
}

// ── Daily check-in ─────────────────────────────────────────────────────────

router.get(
  '/student/daily-checkin',
  authMiddleware,
  handle(async (req, res) => {
    const studentId = await resolveStudentId(req);
    const { take, skip } = pagination(req);
    const checkIns = await prisma.dailyCheckIn.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    res.json(checkIns);
  }),
);

router.post(
  '/student/daily-checkin',
  authMiddleware,
  roleMiddleware(['STUDENT']),
  handle(async (req, res) => {
    const parsed = dailyCheckInSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const created = await prisma.dailyCheckIn.create({
      data: { ...parsed.data, studentId: req.user!.id },
    });
    res.status(201).json(created);
  }),
);

// ── Weekly goals ───────────────────────────────────────────────────────────

router.get(
  '/student/weekly-goals',
  authMiddleware,
  handle(async (req, res) => {
    const studentId = await resolveStudentId(req);
    const { take, skip } = pagination(req);
    const goals = await prisma.weeklyGoal.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
    res.json(goals);
  }),
);

router.post(
  '/student/weekly-goals',
  authMiddleware,
  roleMiddleware(['STUDENT']),
  handle(async (req, res) => {
    const parsed = weeklyGoalSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const created = await prisma.weeklyGoal.create({
      data: { ...parsed.data, studentId: req.user!.id },
    });
    res.status(201).json(created);
  }),
);

router.patch(
  '/student/weekly-goals/:id',
  authMiddleware,
  handle(async (req, res) => {
    const parsed = updateWeeklyGoalSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const goal = await prisma.weeklyGoal.findUnique({ where: { id: req.params.id } });
    // Read the owner before deciding — never trust the caller's own claim of one.
    if (!goal) throw notFound('Goal');
    if (goal.studentId !== req.user!.id) throw notFound('Goal');

    const updated = await prisma.weeklyGoal.update({
      where: { id: goal.id },
      data: parsed.data,
    });
    res.json(updated);
  }),
);

router.delete(
  '/student/weekly-goals/:id',
  authMiddleware,
  roleMiddleware(['STUDENT']),
  handle(async (req, res) => {
    const goal = await prisma.weeklyGoal.findUnique({ where: { id: req.params.id } });
    if (!goal || goal.studentId !== req.user!.id) throw notFound('Goal');

    await prisma.weeklyGoal.delete({ where: { id: goal.id } });
    res.json({ success: true });
  }),
);

// ── Student templates ──────────────────────────────────────────────────────

router.get(
  '/student/templates',
  authMiddleware,
  roleMiddleware(['STUDENT']),
  handle(async (req, res) => {
    const templates = await prisma.studentTemplate.findMany({
      where: { studentId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(templates);
  }),
);

router.post(
  '/student/templates',
  authMiddleware,
  roleMiddleware(['STUDENT']),
  handle(async (req, res) => {
    const parsed = studentTemplateSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const created = await prisma.studentTemplate.create({
      data: { ...parsed.data, studentId: req.user!.id },
    });
    res.status(201).json(created);
  }),
);

router.delete(
  '/student/templates/:id',
  authMiddleware,
  roleMiddleware(['STUDENT']),
  handle(async (req, res) => {
    const template = await prisma.studentTemplate.findUnique({ where: { id: req.params.id } });
    if (!template || template.studentId !== req.user!.id) throw notFound('Template');

    await prisma.studentTemplate.delete({ where: { id: template.id } });
    res.json({ success: true });
  }),
);

// ── Class-change requests ──────────────────────────────────────────────────

router.get(
  '/student/class-requests',
  authMiddleware,
  handle(async (req, res) => {
    const studentId = await resolveStudentId(req);
    const requests = await prisma.classChangeRequest.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: { classModel: { select: { id: true, name: true } } },
    });
    res.json(requests);
  }),
);

router.post(
  '/student/class-requests',
  authMiddleware,
  roleMiddleware(['STUDENT']),
  handle(async (req, res) => {
    const parsed = classChangeRequestSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const classModel = await prisma.classModel.findUnique({ where: { id: parsed.data.classId } });
    if (!classModel) throw bad('Invalid class selected');

    const created = await prisma.classChangeRequest.create({
      data: { ...parsed.data, studentId: req.user!.id },
    });
    res.status(201).json(created);
  }),
);

router.patch(
  '/student/class-requests/:id',
  authMiddleware,
  roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']),
  handle(async (req, res) => {
    const parsed = decideClassChangeSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const existing = await prisma.classChangeRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Request');
    // A PM decides only for students in their own program.
    await assertStudentScope(req.user!, existing.studentId);
    if (existing.status !== 'PENDING') throw bad('Request has already been decided');

    const updated = await prisma.classChangeRequest.update({
      where: { id: existing.id },
      data: {
        status: parsed.data.status,
        decisionNote: parsed.data.decisionNote ?? null,
        decidedById: req.user!.id,
        decidedAt: new Date(),
      },
    });
    res.json(updated);
  }),
);

// ── Coaching goals ─────────────────────────────────────────────────────────

router.get(
  '/coaching-goals/:studentId',
  authMiddleware,
  handle(async (req, res) => {
    const { studentId } = req.params;
    // A student reads their own; staff must hold a real assignment.
    if (!(await canAccessStudent(req.user!, studentId))) throw notFound('Student');

    const goals = await prisma.coachingGoal.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      include: { coach: { select: { id: true, name: true } } },
    });
    res.json(goals);
  }),
);

router.post(
  '/coaching-goals',
  authMiddleware,
  roleMiddleware(['COACH', 'PROGRAM_MANAGER', 'ADMIN']),
  handle(async (req, res) => {
    const parsed = coachingGoalSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    await assertStudentScope(req.user!, parsed.data.studentId);

    const created = await prisma.coachingGoal.create({
      data: {
        studentId: parsed.data.studentId,
        coachId: req.user!.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
      },
    });
    res.status(201).json(created);
  }),
);

router.patch(
  '/coaching-goals/:id',
  authMiddleware,
  roleMiddleware(['COACH', 'PROGRAM_MANAGER', 'ADMIN']),
  handle(async (req, res) => {
    const parsed = updateCoachingGoalSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const goal = await prisma.coachingGoal.findUnique({ where: { id: req.params.id } });
    if (!goal) throw notFound('Goal');
    await assertStudentScope(req.user!, goal.studentId);

    const { deadline, ...rest } = parsed.data;
    const updated = await prisma.coachingGoal.update({
      where: { id: goal.id },
      data: {
        ...rest,
        ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
      },
    });
    res.json(updated);
  }),
);

router.delete(
  '/coaching-goals/:id',
  authMiddleware,
  roleMiddleware(['COACH', 'PROGRAM_MANAGER', 'ADMIN']),
  handle(async (req, res) => {
    const goal = await prisma.coachingGoal.findUnique({ where: { id: req.params.id } });
    if (!goal) throw notFound('Goal');
    await assertStudentScope(req.user!, goal.studentId);

    await prisma.coachingGoal.delete({ where: { id: goal.id } });
    res.json({ success: true });
  }),
);

// ── Report annotations (staff-internal) ────────────────────────────────────
// Annotations are internal staff notes. They are never returned on a student's
// own report read, and are scoped by the report's owning student.

router.get(
  '/annotations',
  authMiddleware,
  roleMiddleware(['COACH', 'ADMIN', 'PROGRAM_MANAGER']),
  handle(async (req, res) => {
    const reportId = typeof req.query.reportId === 'string' ? req.query.reportId : null;
    if (!reportId) throw bad('reportId is required');

    const report = await prisma.weeklyReport.findUnique({
      where: { id: reportId },
      select: { id: true, studentId: true },
    });
    if (!report) throw notFound('Report');
    await assertStudentScope(req.user!, report.studentId);

    const annotations = await prisma.annotation.findMany({
      where: { reportId },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    });
    res.json(annotations);
  }),
);

router.post(
  '/annotations',
  authMiddleware,
  roleMiddleware(['COACH', 'ADMIN', 'PROGRAM_MANAGER']),
  handle(async (req, res) => {
    const parsed = annotationSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed.error.issues[0].message);

    const report = await prisma.weeklyReport.findUnique({
      where: { id: parsed.data.reportId },
      select: { id: true, studentId: true },
    });
    if (!report) throw notFound('Report');
    await assertStudentScope(req.user!, report.studentId);

    const created = await prisma.annotation.create({
      data: { ...parsed.data, authorId: req.user!.id },
    });
    res.status(201).json(created);
  }),
);

router.delete(
  '/annotations/:id',
  authMiddleware,
  roleMiddleware(['COACH', 'ADMIN', 'PROGRAM_MANAGER']),
  handle(async (req, res) => {
    const annotation = await prisma.annotation.findUnique({
      where: { id: req.params.id },
      include: { report: { select: { studentId: true } } },
    });
    if (!annotation) throw notFound('Annotation');
    await assertStudentScope(req.user!, annotation.report.studentId);

    await prisma.annotation.delete({ where: { id: annotation.id } });
    res.json({ success: true });
  }),
);

export default router;
