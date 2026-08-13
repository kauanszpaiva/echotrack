// Rotas de áreas específicas por role: Student, Coach, PM, Instructor
import { Router } from 'express';
import prisma from '../prisma.js';
import { authMiddleware, roleMiddleware } from '../auth.js';
import { isAdminLevel, isCoachLevel, isStudentLevel, STUDENT_LEVEL, COACH_LEVEL } from '../../shared/roles.js';
import { omitSensitive } from './helpers.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// STUDENT
// ═══════════════════════════════════════════════════════════════════════════

router.get('/student/me', authMiddleware, roleMiddleware(['STUDENT']), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { studentProfile: { include: { programManager: true, coach: true, pathway: true, classEnrollments: { include: { classModel: true } } } } }
    });
    const cycleScope = user?.studentProfile?.pathwayId
      ? [{ pathwayId: user.studentProfile.pathwayId }, { pathwayId: null }]
      : [{ pathwayId: null }];
    const openCycle = await prisma.reportCycle.findFirst({
      where: { status: 'OPEN', OR: cycleScope },
      orderBy: { createdAt: 'desc' }
    });
    let currentReport = null;
    if (openCycle) {
      currentReport = await prisma.weeklyReport.findFirst({ where: { studentId: req.user.id, cycleId: openCycle.id } });
    }
    res.json(omitSensitive({ ...user, currentCycle: openCycle, currentReport }));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/student/classes', authMiddleware, roleMiddleware(['STUDENT']), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { studentProfile: { include: { classEnrollments: { include: { classModel: { include: { instructor: true } } } } } } }
    });
    res.json(omitSensitive(user?.studentProfile?.classEnrollments.map((e: any) => e.classModel) || []));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/student/history', authMiddleware, roleMiddleware(['STUDENT']), async (req, res) => {
  try {
    const reports = await prisma.weeklyReport.findMany({
      where: { studentId: req.user.id },
      include: { cycle: true, classRatings: { include: { classModel: true } } },
      orderBy: { submittedAt: 'desc' }
    });
    res.json(reports);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/student/reports', authMiddleware, roleMiddleware(['STUDENT']), async (req, res) => {
  try {
    const reports = await prisma.weeklyReport.findMany({
      where: { studentId: req.user.id },
      include: { cycle: true },
      orderBy: { submittedAt: 'desc' }
    });
    res.json(reports);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// COACH
// ═══════════════════════════════════════════════════════════════════════════

router.get('/coach/dashboard', authMiddleware, roleMiddleware(['COACH']), async (req, res) => {
  try {
    const [students, reports] = await Promise.all([
      prisma.user.findMany({
        where: { role: { in: STUDENT_LEVEL }, studentProfile: { coachId: req.user.id } },
        select: { id: true, name: true, email: true, role: true, accountStatus: true, isActive: true, createdAt: true }
      }),
      prisma.weeklyReport.findMany({
        where: {
          student: { studentProfile: { coachId: req.user.id } },
          status: { in: ['SUBMITTED', 'REVIEWED'] }
        },
        include: { student: true }
      })
    ]);
    res.json({ students, reports: omitSensitive(reports) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/coach/students', authMiddleware, roleMiddleware(['COACH']), async (req, res) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: { in: STUDENT_LEVEL }, studentProfile: { coachId: req.user.id } },
      include: { studentProfile: { include: { pathway: true } } }
    });
    res.json(omitSensitive(students));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/coach/reports', authMiddleware, roleMiddleware(['COACH']), async (req, res) => {
  try {
    const reports = await prisma.weeklyReport.findMany({
      where: {
        student: { studentProfile: { coachId: req.user.id } },
        status: { in: ['SUBMITTED', 'REVIEWED'] }
      },
      include: { student: true, cycle: true, classRatings: true },
      orderBy: { submittedAt: 'desc' }
    });
    res.json(omitSensitive(reports));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/coach/alerts', authMiddleware, roleMiddleware(['COACH']), async (req, res) => {
  try {
    const alerts = await prisma.alert.findMany({
      where: { resolved: false, student: { studentProfile: { coachId: req.user.id } } },
      include: { student: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(omitSensitive(alerts));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PROGRAM MANAGER
// ═══════════════════════════════════════════════════════════════════════════

router.get('/pm/dashboard', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req, res) => {
  try {
    const [students, alerts] = await Promise.all([
      prisma.user.findMany({
        where: { role: { in: STUDENT_LEVEL }, studentProfile: { programManagerId: req.user.id } },
        include: { weeklyReports: { where: { status: { in: ['SUBMITTED', 'REVIEWED'] } } } }
      }),
      prisma.alert.findMany({
        where: { resolved: false, student: { studentProfile: { programManagerId: req.user.id } } },
        include: { student: true }
      })
    ]);
    const studentsWithReports = students.map(s => omitSensitive({ ...s, reports: s.weeklyReports }));
    res.json({ students: studentsWithReports, alerts: omitSensitive(alerts) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/pm/students', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req, res) => {
  try {
    const students = await prisma.user.findMany({
      where: { role: { in: STUDENT_LEVEL }, studentProfile: { programManagerId: req.user.id } },
      include: { studentProfile: { include: { pathway: true, coach: true } } }
    });
    res.json(omitSensitive(students));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/pm/staff', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req, res) => {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['COACH', 'PSM', 'INSTRUCTOR'] }, managerId: req.user.id, isActive: true },
      select: { id: true, name: true, email: true, role: true, accountStatus: true, isActive: true, createdAt: true }
    });
    res.json(staff);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/pm/communities', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req, res) => {
  try {
    const communities = await prisma.community.findMany({
      where: { programManagerId: req.user.id },
      include: { programManager: { select: { id: true, name: true, email: true } } }
    });
    res.json(communities);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/pm/reports', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req, res) => {
  try {
    const reports = await prisma.weeklyReport.findMany({
      where: {
        student: { studentProfile: { programManagerId: req.user.id } },
        status: { in: ['SUBMITTED', 'REVIEWED'] }
      },
      include: { student: true, cycle: true, classRatings: true },
      orderBy: { submittedAt: 'desc' }
    });
    res.json(omitSensitive(reports));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/pm/analytics', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req, res) => {
  try {
    const pmId = req.user.id;
    const [totalStudents, cycle] = await Promise.all([
      prisma.user.count({ where: { role: { in: STUDENT_LEVEL }, isActive: true, studentProfile: { programManagerId: pmId } } }),
      prisma.reportCycle.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } })
    ]);

    let submissionRate = 0;
    let activeAlerts = 0;

    if (cycle) {
      const submittedCount = await prisma.weeklyReport.count({
        where: { cycleId: cycle.id, student: { studentProfile: { programManagerId: pmId } } }
      });
      if (totalStudents > 0) submissionRate = Math.round((submittedCount / totalStudents) * 100);
    }

    activeAlerts = await prisma.alert.count({
      where: { resolved: false, student: { studentProfile: { programManagerId: pmId } } }
    });

    res.json({ totalStudents, submissionRate, activeAlerts, classPerformance: {}, alertDistribution: [] });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INSTRUCTOR
// ═══════════════════════════════════════════════════════════════════════════

router.get('/instructor/dashboard', authMiddleware, roleMiddleware(['INSTRUCTOR']), async (req, res) => {
  try {
    const classes = await prisma.classModel.findMany({
      where: { instructorId: req.user.id, isActive: true },
      include: { _count: { select: { studentClassEnrollments: true } } }
    });
    const ratings = await prisma.classRating.findMany({
      where: { classModel: { instructorId: req.user.id } },
      include: { classModel: true }
    });
    res.json({ classes, ratings });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/instructor/classes', authMiddleware, roleMiddleware(['INSTRUCTOR']), async (req, res) => {
  try {
    const classes = await prisma.classModel.findMany({
      where: { instructorId: req.user.id, isActive: true },
      include: { studentClassEnrollments: { include: { studentProfile: { include: { user: true } } } } }
    });
    res.json(omitSensitive(classes));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/instructor/reports', authMiddleware, roleMiddleware(['INSTRUCTOR']), async (req, res) => {
  try {
    const myClasses = await prisma.classModel.findMany({ where: { instructorId: req.user.id } });
    const classIds = myClasses.map(c => c.id);
    const ratings = await prisma.classRating.findMany({
      where: { classId: { in: classIds } },
      include: { report: { include: { student: true, cycle: true } }, classModel: true }
    });
    const reports = new Map();
    for (const r of ratings) {
      if (!reports.has(r.reportId)) reports.set(r.reportId, r.report);
    }
    res.json(omitSensitive(Array.from(reports.values())));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SHARED (Alerts)
// ═══════════════════════════════════════════════════════════════════════════

router.patch('/alerts/:id/resolve', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER', 'COACH']), async (req, res) => {
  try {
    const alertInfo = await prisma.alert.findUnique({
      where: { id: req.params.id },
      include: { student: { include: { studentProfile: true } } }
    });
    if (!alertInfo) return res.status(404).json({ error: 'Alert not found' });

    const reqUser = req.user;
    let authorized = false;
    if (isAdminLevel(reqUser.role)) authorized = true;
    else if (isCoachLevel(reqUser.role) && alertInfo.student.studentProfile?.coachId === reqUser.id) authorized = true;
    else if (reqUser.role === 'PROGRAM_MANAGER' && alertInfo.student.studentProfile?.programManagerId === reqUser.id) authorized = true;

    if (!authorized) return res.status(403).json({ error: 'Unauthorized to resolve this alert' });

    await prisma.alert.update({ where: { id: req.params.id }, data: { resolved: true } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
