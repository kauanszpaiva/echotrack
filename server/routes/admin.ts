// Rotas administrativas - gerenciamento de sistema
import { Router } from 'express';
import prisma from '../prisma.js';
import { authMiddleware, roleMiddleware } from '../auth.js';
import { isAdminLevel, isCoachLevel, isStudentLevel, STUDENT_LEVEL, COACH_LEVEL } from '../../shared/roles.js';
import { provisionClerkUser, deleteClerkUser } from '../clerkAdmin.js';
import { registerStaffSchema, inviteSchema, pathwaySchema, classSchema, communitySchema, cycleSchema, updateCycleSchema, settingsSchema, targetedQuestionSchema } from '../schemas.js';
import { omitSensitive, newInvite, requiredString, httpError } from './helpers.js';

const router = Router();

// ── Registro de Staff ──────────────────────────────────────────────────────

router.post('/register-staff', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
  const parsed = registerStaffSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { name, email, password, role } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  let newRole = role;
  if (isAdminLevel((req as any).user.role)) {
    if (!['PROGRAM_MANAGER', 'COACH', 'PSM', 'INSTRUCTOR', 'INTERN'].includes(newRole)) {
      return res.status(400).json({ error: 'Invalid staff role' });
    }
  } else {
    if (!['COACH', 'PSM', 'INSTRUCTOR'].includes(newRole)) {
      return res.status(400).json({ error: 'Program Managers can only create coaches, PSMs or instructors' });
    }
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const clerkUser = await provisionClerkUser({
      email: normalizedEmail, password, name, role: newRole,
    });

    let user;
    try {
      user = await prisma.user.create({
        data: {
          id: clerkUser.id,
          clerkUserId: clerkUser.id,
          name, email: normalizedEmail,
          role: newRole,
          accountStatus: 'ACTIVE',
          isActive: true,
          managerId: (req as any).user.role === 'PROGRAM_MANAGER' ? (req as any).user.id : undefined
        }
      });
    } catch (dbError) {
      if (clerkUser.created) await deleteClerkUser(clerkUser.id);
      throw dbError;
    }

    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'USER', entityId: user.id, description: `${isAdminLevel((req as any).user?.role) ? 'Admin' : 'Program Manager'} registered ${newRole} ${name}` }
    });

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus }
    });
  } catch (e: any) {
    console.error('REGISTER ERROR:', e);
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Unable to create the user' });
  }
});

// ── Convite de PM ──────────────────────────────────────────────────────────

router.post('/invite', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  const parsed = inviteSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { name, email } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const invite = newInvite();

    const user = await prisma.user.create({
      data: {
        name, email: normalizedEmail,
        role: 'PROGRAM_MANAGER',
        accountStatus: 'INVITED',
        isActive: true,
        ...invite
      }
    });

    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'USER', entityId: user.id, description: `Admin invited Program Manager ${name}` }
    });

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus },
      setupLink: `/setup-account?token=${invite.inviteToken}`,
      setupLinkExpiresAt: invite.inviteExpires.toISOString()
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

router.delete('/invite', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const { id } = (req as any).query;
    await prisma.user.update({
      where: { id: String(id) },
      data: { accountStatus: 'DEACTIVATED', isActive: false }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Pathways ───────────────────────────────────────────────────────────────

router.get('/pathways', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pathways = await prisma.pathway.findMany({
      where: { isActive: true },
      include: { _count: { select: { classes: true, studentProfiles: true } } }
    });
    const mapped = pathways.map(p => ({
      ...p,
      classesCount: p._count.classes,
      studentsCount: p._count.studentProfiles,
      instructorsCount: 0
    }));
    res.json(mapped);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/pathways', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  const parsed = pathwaySchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const pathway = await prisma.pathway.create({ data: parsed.data });
    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'Pathway', entityId: pathway.id, description: `Created pathway ${pathway.name}` }
    });
    res.json(pathway);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/pathways', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const { id } = (req as any).query;
    await prisma.pathway.update({ where: { id: String(id) }, data: { isActive: false } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Classes ────────────────────────────────────────────────────────────────

router.get('/classes', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const classes = await prisma.classModel.findMany({
      where: { isActive: true },
      include: { pathway: true, instructor: true }
    });
    res.json(omitSensitive(classes));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/classes', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  const parsed = classSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const cls = await prisma.classModel.create({ data: parsed.data });
    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'Class', entityId: cls.id, description: `Created class ${cls.name}` }
    });
    res.json(cls);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/classes', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const { id } = (req as any).query;
    await prisma.classModel.update({ where: { id: String(id) }, data: { isActive: false } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Communities ────────────────────────────────────────────────────────────

router.get('/communities', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const communities = await prisma.community.findMany({
      where: { isActive: true },
      include: { programManager: true, _count: { select: { studentProfiles: true } } }
    });
    res.json(omitSensitive(communities.map(c => ({ ...c, studentsCount: c._count.studentProfiles }))));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/communities', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  const parsed = communitySchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const comm = await prisma.community.create({ data: parsed.data });
    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'Community', entityId: comm.id, description: `Created community: ${comm.name}` }
    });
    res.json(comm);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/communities', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const { id } = (req as any).query;
    await prisma.community.update({ where: { id: String(id) }, data: { isActive: false } });
    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'DELETE', entityType: 'Community', entityId: String(id), description: `Deactivated community` }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Cycles ─────────────────────────────────────────────────────────────────

router.get('/cycles', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const cycles = await prisma.reportCycle.findMany({
      include: { pathway: true, _count: { select: { weeklyReports: true } } }
    });
    res.json(cycles.map(c => ({ ...c, reportsCount: c._count.weeklyReports })));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/cycles', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  const parsed = cycleSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    if (parsed.data.status === 'OPEN') {
      const hasOpen = await prisma.reportCycle.findFirst({
        where: { status: 'OPEN', pathwayId: parsed.data.pathwayId }
      });
      if (hasOpen) return res.status(400).json({ error: 'An OPEN cycle already exists for this scope' });
    }

    const cycle = await prisma.reportCycle.create({
      data: {
        name: parsed.data.name,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        status: parsed.data.status,
        pathwayId: parsed.data.pathwayId
      }
    });
    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'ReportCycle', entityId: cycle.id, description: `Created cycle: ${cycle.name}` }
    });
    res.json(cycle);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/cycles/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  const parsed = updateCycleSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const { id } = (req as any).params;
    if (parsed.data.status === 'OPEN') {
      const cycle = await prisma.reportCycle.findUnique({ where: { id } });
      const hasOpen = await prisma.reportCycle.findFirst({
        where: { status: 'OPEN', pathwayId: cycle?.pathwayId }
      });
      if (hasOpen && hasOpen.id !== id) return res.status(400).json({ error: 'An OPEN cycle already exists' });
    }

    await prisma.reportCycle.update({ where: { id }, data: { status: parsed.data.status } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Users ──────────────────────────────────────────────────────────────────

router.get('/users', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
  try {
    const where = (req as any).user.role === 'PROGRAM_MANAGER'
      ? {
        OR: [
          { managerId: (req as any).user.id },
          { studentProfile: { programManagerId: (req as any).user.id } }
        ]
      }
      : {};
    const users = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, accountStatus: true },
      orderBy: { name: 'asc' }
    });
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/users/:id', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
  try {
    const { id } = (req as any).params;
    const { isActive } = (req as any).body;

    const targetUser = await prisma.user.findUnique({ where: { id }, include: { studentProfile: true } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    if ((req as any).user.role === 'PROGRAM_MANAGER') {
      const managesStaff = targetUser.managerId === (req as any).user.id;
      const managesStudent = targetUser.studentProfile?.programManagerId === (req as any).user.id;
      if (!managesStaff && !managesStudent) return res.status(403).json({ error: 'Forbidden' });
    }

    if ((req as any).user.role === 'PROGRAM_MANAGER' && (isAdminLevel(targetUser.role) || targetUser.role === 'PROGRAM_MANAGER')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.user.update({
      where: { id },
      data: { isActive, accountStatus: isActive ? 'ACTIVE' : 'DEACTIVATED' }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Settings ───────────────────────────────────────────────────────────────

router.get('/settings', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    let settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings) {
      settings = await prisma.appSettings.create({ data: { id: 'singleton' } });
    }
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/settings', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  const parsed = settingsSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const updated = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...parsed.data },
      update: parsed.data
    });

    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'UPDATE', entityType: 'Settings', entityId: 'singleton', description: 'Updated app settings' }
    });
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Targeted Questions ─────────────────────────────────────────────────────

router.get('/targeted-questions', authMiddleware, async (req, res) => {
  try {
    const where: any = { isActive: true };
    if (isStudentLevel((req as any).user.role)) {
      where.studentId = (req as any).user.id;
    } else if ((req as any).user.role === 'PROGRAM_MANAGER') {
      const students = await prisma.user.findMany({
        where: { role: { in: STUDENT_LEVEL }, studentProfile: { programManagerId: (req as any).user.id } },
        select: { id: true }
      });
      where.studentId = { in: students.map((s) => s.id) };
    } else if (isCoachLevel((req as any).user.role)) {
      const students = await prisma.user.findMany({
        where: { role: { in: STUDENT_LEVEL }, studentProfile: { coachId: (req as any).user.id } },
        select: { id: true }
      });
      where.studentId = { in: students.map((s) => s.id) };
    } else if (!isAdminLevel((req as any).user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const questions = await prisma.targetedQuestion.findMany({
      where,
      include: { cycle: true }
    });
    res.json(questions);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/targeted-questions', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
  const parsed = targetedQuestionSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  try {
    const { question, studentId, cycleId } = parsed.data;
    const student = await prisma.user.findUnique({
      where: { id: studentId },
      include: { studentProfile: true }
    });
    if (!student || !isStudentLevel(student.role) || !student.isActive || student.accountStatus !== 'ACTIVE') {
      return res.status(400).json({ error: 'Invalid student selected' });
    }

    if ((req as any).user.role === 'PROGRAM_MANAGER') {
      if (student?.studentProfile?.programManagerId !== (req as any).user.id) {
        return res.status(403).json({ error: 'Unauthorized to target this student' });
      }
    }

    const created = await prisma.targetedQuestion.create({
      data: { question, studentId, cycleId: cycleId || null, creatorId: (req as any).user.id }
    });
    res.json(created);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

router.delete('/targeted-questions', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
  try {
    const { id } = (req as any).query;
    const q = await prisma.targetedQuestion.findUnique({ where: { id: String(id) } });
    if (!q) return res.status(404).json({ error: 'Not found' });

    if ((req as any).user.role === 'PROGRAM_MANAGER' && q.creatorId !== (req as any).user.id) {
      return res.status(403).json({ error: 'Unauthorized to delete this question' });
    }

    await prisma.targetedQuestion.update({ where: { id: String(id) }, data: { isActive: false } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Audit Logs ─────────────────────────────────────────────────────────────

router.get('/audit', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Instructors ────────────────────────────────────────────────────────────

router.get('/instructors', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const instructors = await prisma.user.findMany({
      where: { role: 'INSTRUCTOR', isActive: true },
      select: { id: true, name: true }
    });
    res.json(instructors);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Analytics ──────────────────────────────────────────────────────────────

router.get('/analytics', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res, next) => {
  try {
    if ((req as any).user.role === 'PROGRAM_MANAGER') {
      const pmId = (req as any).user.id;
      const [totalStudents, totalStaff, cycle, submittedReportsThisCycle, reviewedReportsThisCycle, activeAlerts, needsSupportReports] = await Promise.all([
        prisma.user.count({ where: { role: { in: STUDENT_LEVEL }, isActive: true, studentProfile: { programManagerId: pmId } } }),
        prisma.user.count({ where: { isActive: true, managerId: pmId } }),
        prisma.reportCycle.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } }),
        prisma.weeklyReport.count({ where: { status: 'SUBMITTED', student: { studentProfile: { programManagerId: pmId } } } }),
        prisma.weeklyReport.count({ where: { status: 'REVIEWED', student: { studentProfile: { programManagerId: pmId } } } }),
        prisma.alert.count({ where: { resolved: false, student: { studentProfile: { programManagerId: pmId } } } }),
        prisma.weeklyReport.findMany({
          where: { needsSupport: true, student: { studentProfile: { programManagerId: pmId } } },
          select: { studentId: true }
        })
      ]);

      const openCycle = cycle;
      const submittedCount = openCycle ? submittedReportsThisCycle : 0;

      return res.json({
        totalStudents,
        totalActiveUsers: totalStudents + totalStaff + 1,
        totalProgramManagers: 1,
        totalPathways: await prisma.pathway.count({ where: { isActive: true, studentProfiles: { some: { programManagerId: pmId } } } }),
        totalClasses: 0,
        submittedReportsThisCycle: submittedCount,
        submissionRate: totalStudents > 0 ? Math.round(((submittedCount + reviewedReportsThisCycle) / totalStudents) * 100) : 0,
        reviewedRate: submittedCount > 0 ? Math.round((reviewedReportsThisCycle / submittedCount) * 100) : 0,
        overdueReports: 0,
        studentsNeedingSupport: new Set(needsSupportReports.map((r) => r.studentId)).size,
        activeAlerts,
        alertDistribution: [],
        classPerformance: { overall: {}, byPathway: [] },
        submissionTrend: [],
        recentActivity: []
      });
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      totalStudents,
      totalActiveUsers,
      cycle,
      openCyclesPastDue,
      needsSupportReports,
      activeAlertsCount,
      typeGroups,
      recentActivity,
      trend,
      allRatings,
      totalProgramManagers,
      totalPathways,
      totalClasses,
    ] = await Promise.all([
      prisma.user.count({ where: { role: { in: STUDENT_LEVEL }, isActive: true } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.reportCycle.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } }),
      prisma.reportCycle.count({ where: { status: 'OPEN', endDate: { lt: new Date() } } }),
      prisma.weeklyReport.findMany({ where: { needsSupport: true }, select: { studentId: true } }),
      prisma.alert.count({ where: { resolved: false } }),
      prisma.alert.groupBy({ by: ['type'], _count: { id: true } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.weeklyReport.groupBy({
        by: ['createdAt'],
        _count: { id: true },
        where: { createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.classRating.findMany({ select: { rating: true } }),
      prisma.user.count({ where: { role: 'PROGRAM_MANAGER', isActive: true } }),
      prisma.pathway.count({ where: { isActive: true } }),
      prisma.classModel.count({ where: { isActive: true } }),
    ]);

    let submissionRate = 0;
    let reviewedRate = 0;
    let submittedCount = 0;

    if (cycle) {
      const [submitted, reviewed] = await Promise.all([
        prisma.weeklyReport.count({ where: { cycleId: cycle.id, status: 'SUBMITTED' } }),
        prisma.weeklyReport.count({ where: { cycleId: cycle.id, status: 'REVIEWED' } }),
      ]);
      submittedCount = submitted;
      if (totalStudents > 0) submissionRate = Math.round((submitted / totalStudents) * 100);
      if (submitted > 0) reviewedRate = Math.round((reviewed / submitted) * 100);
    }

    const overdueReports = openCyclesPastDue * totalStudents;
    const studentsNeedingSupport = new Set(needsSupportReports.map(r => r.studentId)).size;
    const alertDistribution = typeGroups.map(g => ({ type: g.type, count: g._count.id }));
    const submissionTrend = trend.map(t => ({ date: t.createdAt.toISOString().split('T')[0], count: t._count.id }));

    const performance = {
      EXCEEDING: allRatings.filter(r => r.rating === 'EXCEEDING').length,
      MEETING: allRatings.filter(r => r.rating === 'MEETING').length,
      APPROACHING: allRatings.filter(r => r.rating === 'APPROACHING').length,
      BEGINNING: allRatings.filter(r => r.rating === 'BEGINNING').length,
    };

    res.json({
      totalStudents,
      totalActiveUsers,
      totalProgramManagers,
      totalPathways,
      totalClasses,
      submittedReportsThisCycle: submittedCount,
      submissionRate,
      reviewedRate,
      overdueReports,
      studentsNeedingSupport,
      activeAlerts: activeAlertsCount,
      alertDistribution,
      classPerformance: { overall: performance, byPathway: [] },
      submissionTrend,
      recentActivity
    });
  } catch (e) {
    return next(e);
  }
});

export default router;
