// Rotas de relatórios semanais - core do sistema EchoTrack
import { Router } from 'express';
import prisma from '../prisma.js';
import { authMiddleware, roleMiddleware } from '../auth.js';
import { isAdminLevel, isCoachLevel, isStudentLevel } from '../../shared/roles.js';
import { weeklyReportSchema } from '../schemas.js';
import { generateDocx, generatePdf } from '../exports.js';
import { omitSensitive, REPORT_STATUSES_FROM_STUDENT, PERFORMANCE_LEVELS, optionalInt, optionalString, requiredString, uniqueStrings, httpError } from './helpers.js';

const router = Router();

// Criar ou atualizar relatório do estudante
router.post('/', authMiddleware, roleMiddleware(['STUDENT']), async (req, res) => {
  const parsed = weeklyReportSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const payload = parsed.data;
  const studentId = (req as any).user?.id;

  try {
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: studentId },
      include: { classEnrollments: { where: { isActive: true } } }
    });
    if (!profile) return res.status(400).json({ error: 'Student profile not found' });

    const cycle = await prisma.reportCycle.findFirst({
      where: {
        status: 'OPEN',
        OR: [{ pathwayId: profile.pathwayId }, { pathwayId: null }],
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!cycle) {
      return res.status(400).json({ error: 'No open report cycle is available.' });
    }

    if (!REPORT_STATUSES_FROM_STUDENT.has(payload.status)) {
      return res.status(400).json({ error: 'Students can only save DRAFT or SUBMITTED reports.' });
    }

    const existingReport = await prisma.weeklyReport.findUnique({
      where: { studentId_cycleId: { studentId, cycleId: cycle.id } }
    });
    if (existingReport && existingReport.status !== 'DRAFT') {
      return res.status(409).json({ error: 'Submitted or reviewed reports can no longer be edited.' });
    }

    // Parse challenge tags
    let challengeTags: string[] = [];
    if (typeof payload.challengesTags === 'string') {
      try {
        challengeTags = JSON.parse(payload.challengesTags);
      } catch {
        return res.status(400).json({ error: 'challengesTags must be valid JSON' });
      }
    } else if (payload.challengesTags !== undefined && Array.isArray(payload.challengesTags)) {
      challengeTags = payload.challengesTags;
    }

    // Validate class ratings
    const ratingPayloads = payload.classRatings || [];
    const enrolledClassIds = new Set(profile.classEnrollments.map((e) => e.classId));
    const classRatings = new Map<string, { classId: string; rating: string; comment: string | null }>();
    
    for (const rating of ratingPayloads) {
      if (!enrolledClassIds.has(rating.classId)) {
        return res.status(403).json({ error: 'Cannot rate a class you are not enrolled in' });
      }
      if (!PERFORMANCE_LEVELS.has(rating.rating)) {
        return res.status(400).json({ error: 'Invalid class rating value' });
      }
      classRatings.set(rating.classId, { classId: rating.classId, rating: rating.rating, comment: rating.comment ?? null });
    }

    // Validate targeted answers
    const answerPayloads = payload.targetedAnswers || [];
    const targetedAnswers = answerPayloads.map((a) => ({
      questionId: a.questionId,
      answer: a.answer
    }));
    const targetedQuestionIds = [...new Set(targetedAnswers.map((a) => a.questionId))];
    
    if (targetedQuestionIds.length > 0) {
      const validQuestions = await prisma.targetedQuestion.findMany({
        where: {
          id: { in: targetedQuestionIds },
          studentId,
          isActive: true,
          OR: [{ cycleId: cycle.id }, { cycleId: null }]
        },
        select: { id: true }
      });
      if (validQuestions.length !== targetedQuestionIds.length) {
        return res.status(403).json({ error: 'One or more targeted questions are not assigned to you.' });
      }
    }

    const reportData = {
      status: payload.status,
      submittedAt: payload.status === 'SUBMITTED' ? new Date() : null,
      energy: payload.energy ?? 5,
      mood: payload.mood ?? 5,
      attendance: payload.attendance ?? 100,
      confidence: payload.confidence ?? 5,
      weeklyTopic: payload.weeklyTopic || null,
      highlights: payload.highlights || null,
      academicProgress: payload.academicProgress || null,
      classExperience: payload.classExperience || null,
      instructorSupport: payload.instructorSupport || null,
      events: payload.events || null,
      upcomingEvents: payload.upcomingEvents || null,
      challengesTags: JSON.stringify(challengeTags),
      challengesText: payload.challengesText || null,
      needsSupport: payload.needsSupport ?? false,
      supportNeeded: payload.supportNeeded || null,
      reflection: payload.reflection || null,
      goals: payload.goals || null
    };

    const report = await prisma.$transaction(async (tx) => {
      const savedReport = await tx.weeklyReport.upsert({
        where: { studentId_cycleId: { studentId, cycleId: cycle.id } },
        update: reportData,
        create: { studentId, cycleId: cycle.id, ...reportData }
      });

      for (const ans of targetedAnswers) {
        await tx.targetedAnswer.upsert({
          where: { questionId_reportId: { questionId: ans.questionId, reportId: savedReport.id } },
          update: { answer: ans.answer, studentId },
          create: { questionId: ans.questionId, reportId: savedReport.id, studentId, answer: ans.answer }
        });
      }

      await tx.classRating.deleteMany({ where: { reportId: savedReport.id } });
      const classRatingData = [...classRatings.values()].map((rating) => ({
        reportId: savedReport.id, ...rating
      }));
      if (classRatingData.length > 0) {
        await tx.classRating.createMany({ data: classRatingData });
      }

      return savedReport;
    });

    // Trigger alerts on submission
    if (payload.status === 'SUBMITTED') {
      const settings = await prisma.appSettings.findFirst() || {} as any;
      const thresholdEnergy = settings.alertThresholdEnergy || 3;
      const thresholdMood = settings.alertThresholdMood || 3;
      const thresholdAttend = settings.alertThresholdAttend || 70;
      const thresholdConf = settings.alertThresholdConf || 3;

      let alertsTriggered = 0;
      const createAlertIfNew = async (type: string, severity: string, description: string) => {
        const existing = await prisma.alert.findFirst({
          where: { studentId, description, resolved: false }
        });
        if (!existing) {
          alertsTriggered++;
          await prisma.alert.create({ data: { studentId, type, severity, description } });
        }
      };

      if ((reportData.energy ?? 5) < thresholdEnergy) await createAlertIfNew('LOW_ENERGY', 'MEDIUM', 'Student reported low energy');
      if ((reportData.mood ?? 5) < thresholdMood) await createAlertIfNew('LOW_MOOD', 'MEDIUM', 'Student reported low mood');
      if ((reportData.attendance ?? 100) < thresholdAttend) await createAlertIfNew('LOW_ATTENDANCE', 'HIGH', 'Attendance dropped below threshold');
      if ((reportData.confidence ?? 5) < thresholdConf) await createAlertIfNew('LOW_CONFIDENCE', 'MEDIUM', 'Student reported low confidence');
      if (reportData.needsSupport) await createAlertIfNew('SUPPORT_NEEDED', 'HIGH', 'Student explicitly requested support');
      
      const hasBeginning = [...classRatings.values()].some((cr) => cr.rating === 'BEGINNING');
      if (hasBeginning) await createAlertIfNew('LOW_PERFORMANCE', 'HIGH', 'Student reported BEGINNING in a class');
      if (challengeTags.length > 2) await createAlertIfNew('CHALLENGE_FLAGGED', 'MEDIUM', 'Multiple challenges flagged');

      if (alertsTriggered >= 3) {
        await prisma.alert.updateMany({
          where: { studentId, resolved: false },
          data: { severity: 'CRITICAL' }
        });
      }

      await prisma.auditLog.create({
        data: { actorId: studentId, actorRole: 'STUDENT', action: 'STATUS_CHANGE', entityType: 'WeeklyReport', entityId: report.id, description: 'Submitted weekly report' }
      });
    }

    res.json({ id: report.id });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
});

// Buscar relatório por ID (com autorização)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const report = await prisma.weeklyReport.findUnique({
      where: { id: (req as any).params.id },
      include: {
        student: { include: { studentProfile: { include: { coach: true, programManager: true, pathway: true, classEnrollments: { include: { classModel: true } } } } } },
        cycle: true,
        classRatings: { include: { classModel: true } },
        targetedAnswers: { include: { question: true } },
        coachFeedback: { include: { coach: true } }
      }
    });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const reqUser = (req as any).user;
    let authorized = false;
    if (isAdminLevel(reqUser.role)) authorized = true;
    else if (isStudentLevel(reqUser.role) && report.studentId === reqUser.id) authorized = true;
    else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
    else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;
    else if (reqUser.role === 'INSTRUCTOR') {
      const enrollments = report.student.studentProfile?.classEnrollments || [];
      authorized = enrollments.some((ce: any) => ce.classModel?.instructorId === reqUser.id);
    }

    if (!authorized) return res.status(403).json({ error: 'Unauthorized' });
    res.json(omitSensitive(report));
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Marcar relatório como revisado
router.patch('/:id/review', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER', 'COACH']), async (req, res) => {
  try {
    const { id } = (req as any).params;
    const report = await prisma.weeklyReport.findUnique({
      where: { id },
      include: { student: { include: { studentProfile: true } } }
    });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'SUBMITTED') {
      return res.status(400).json({ error: 'Only submitted reports can be marked as reviewed' });
    }

    const reqUser = (req as any).user;
    let authorized = false;
    if (isAdminLevel(reqUser.role)) authorized = true;
    else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
    else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;

    if (!authorized) return res.status(403).json({ error: 'Unauthorized to review this report' });

    await prisma.weeklyReport.update({ where: { id }, data: { status: 'REVIEWED' } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Feedback no relatório
router.post('/:id/feedback', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER', 'COACH']), async (req, res) => {
  try {
    const text = (req as any).body.text;
    if (!text || typeof text !== 'string' || text.length < 1 || text.length > 4000) {
      return res.status(400).json({ error: 'Feedback text must be between 1 and 4000 characters' });
    }

    const report = await prisma.weeklyReport.findUnique({
      where: { id: (req as any).params.id },
      include: { student: { include: { studentProfile: true } } }
    });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const reqUser = (req as any).user;
    let authorized = false;
    if (isAdminLevel(reqUser.role)) authorized = true;
    else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
    else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;

    if (!authorized) return res.status(403).json({ error: 'Unauthorized to give feedback on this report' });

    const feedback = await prisma.coachFeedback.create({
      data: { reportId: (req as any).params.id, coachId: (req as any).user.id, feedback: text }
    });
    res.json({ success: true, text, feedback });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

// Exportar relatório em DOCX
router.get('/export-docx', authMiddleware, async (req, res) => {
  try {
    const { id } = (req as any).query;
    const report = await prisma.weeklyReport.findUnique({
      where: { id: String(id) },
      include: { student: { include: { studentProfile: { include: { classEnrollments: { include: { classModel: true } } } } } }, cycle: true, classRatings: true }
    });
    if (!report) return res.status(404).json({ error: 'Not found' });

    const reqUser = (req as any).user;
    let authorized = false;
    if (isAdminLevel(reqUser.role)) authorized = true;
    else if (isStudentLevel(reqUser.role) && report.studentId === reqUser.id) authorized = true;
    else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
    else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;
    else if (reqUser.role === 'INSTRUCTOR') {
      const enrollments = report.student.studentProfile?.classEnrollments || [];
      authorized = enrollments.some((ce: any) => ce.classModel?.instructorId === reqUser.id);
    }

    if (!authorized) return res.status(403).json({ error: 'Unauthorized' });

    const buffer = await generateDocx(omitSensitive(report));
    const filename = `EchoTrack_Report_${report.student.name.replace(/ /g, '_')}.docx`;

    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'EXPORT', entityType: 'WeeklyReport', entityId: report.id, description: 'Exported DOCX' }
    });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Exportar relatório em PDF
router.get('/export-pdf', authMiddleware, async (req, res) => {
  try {
    const { id } = (req as any).query;
    const report = await prisma.weeklyReport.findUnique({
      where: { id: String(id) },
      include: { student: { include: { studentProfile: { include: { classEnrollments: { include: { classModel: true } } } } } }, cycle: true, classRatings: true }
    });
    if (!report) return res.status(404).json({ error: 'Not found' });

    const reqUser = (req as any).user;
    let authorized = false;
    if (isAdminLevel(reqUser.role)) authorized = true;
    else if (isStudentLevel(reqUser.role) && report.studentId === reqUser.id) authorized = true;
    else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
    else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;
    else if (reqUser.role === 'INSTRUCTOR') {
      const enrollments = report.student.studentProfile?.classEnrollments || [];
      authorized = enrollments.some((ce: any) => ce.classModel?.instructorId === reqUser.id);
    }

    if (!authorized) return res.status(403).json({ error: 'Unauthorized' });

    const stream = await generatePdf(omitSensitive(report));
    const filename = `EchoTrack_Report_${report.student.name.replace(/ /g, '_')}.pdf`;

    await prisma.auditLog.create({
      data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'EXPORT', entityType: 'WeeklyReport', entityId: report.id, description: 'Exported PDF' }
    });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');
    stream.pipe(res);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
