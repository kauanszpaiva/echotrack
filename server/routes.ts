import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authMiddleware, AuthRequest, roleMiddleware } from './auth.js';
import { JWT_SECRET } from './config.js';
import prisma from './prisma.js';
import { isAdminLevel, isCoachLevel, isStudentLevel, STUDENT_LEVEL, COACH_LEVEL } from '../shared/roles.js';
import { provisionSupabaseAuthUser } from './supabaseAdmin.js';

const router = Router();

// Recursively strips password and inviteToken from any object/array before sending to client
function omitSensitive(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(omitSensitive);
  const { password, inviteToken, ...rest } = obj;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, omitSensitive(v)]));
}

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw httpError(400, `${field} is too long`);
  return trimmed;
}

function requiredString(value: unknown, field: string, maxLength: number) {
  const text = optionalString(value, field, maxLength);
  if (!text) throw httpError(400, `${field} is required`);
  return text;
}

function optionalInt(value: unknown, field: string, min: number, max: number, fallback: number) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
    throw httpError(400, `${field} must be an integer from ${min} to ${max}`);
  }
  return numberValue;
}

function uniqueStrings(values: unknown, field: string, maxItems = 50) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw httpError(400, `${field} must be an array`);
  const clean = values.map((value) => requiredString(value, field, 128));
  if (clean.length > maxItems) throw httpError(400, `${field} has too many values`);
  return [...new Set(clean)];
}

const REPORT_STATUSES_FROM_STUDENT = new Set(['DRAFT', 'SUBMITTED']);
const PERFORMANCE_LEVELS = new Set(['EXCEEDING', 'MEETING', 'APPROACHING', 'BEGINNING']);

console.log("[SERVER] Mounting routes...");

function authError(res: any, status: number, code: string, message: string) {
  return res.status(status).json({ code, error: message });
}

function getCookieOptions(req: any) {
  const sameSite = process.env.COOKIE_SAMESITE === 'none' || process.env.FRONTEND_EMBEDDED === 'true' ? 'none' : 'lax';
  const forwardedProto = String(req.get?.('x-forwarded-proto') || '');
  const isHttps = req.secure || forwardedProto.split(',').some((proto) => proto.trim() === 'https');

  return {
    httpOnly: true,
    secure: sameSite === 'none' || process.env.NODE_ENV === 'production' || isHttps,
    sameSite: sameSite as 'lax' | 'none',
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  };
}

import { verifyIdToken } from './firebase-admin.js';

router.post('/auth/oauth', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' });

    let decoded;
    try {
      decoded = await verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid Firebase token' });
    }

    if (!decoded.email) {
      return res.status(400).json({ error: 'Provider did not return an email' });
    }

    const email = decoded.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({
        error: 'No account found for this email',
        email,
        name: decoded.name,
      });
    }

    if (!user.isActive || user.accountStatus === 'DEACTIVATED') {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    if (user.accountStatus === 'INVITED') {
      return res.status(403).json({
        error: 'Account not yet activated. Use your setup link first.',
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.cookie('token', token, getCookieOptions(req));

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        action: 'LOGIN',
        entityType: 'User',
        entityId: user.id,
        description: `OAuth login via ${decoded.provider}`,
      },
    });

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).json({ error: 'OAuth login failed' });
  }
});

router.post('/setup-account', async (req: any, res: any) => {
    try {
        const token = requiredString(req.body.token, 'token', 256);
        const password = req.body.password;
        if (!password || typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'Valid token and password (min 8 chars) required' });
        }

        const user = await prisma.user.findUnique({ where: { inviteToken: token } });
        if (!user || user.accountStatus !== 'INVITED') {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        // Create the Supabase auth identity for this invited user (role from the
        // invite row, authoritative in app_metadata), then activate the mirror.
        await provisionSupabaseAuthUser({
            email: user.email, password: String(password), name: user.name, role: user.role,
        });

        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                password: '',
                inviteToken: null,
                accountStatus: 'ACTIVE',
            }
        });

        await prisma.auditLog.create({
           data: { actorId: updatedUser.id, actorRole: updatedUser.role, action: 'ACTIVATE', entityType: 'User', entityId: updatedUser.id, description: `User setup account via token` }
        });

        res.json({
          success: true,
          user: { id: updatedUser.id, email: updatedUser.email, name: updatedUser.name, role: updatedUser.role }
        });
    } catch(e: any) {
        res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
    }
});
router.get('/signup/options', async (req, res) => {
    try {
        const { programManagerId, pathwayId } = req.query;
        
        const pms = await prisma.user.findMany({ where: { role: 'PROGRAM_MANAGER', accountStatus: 'ACTIVE', isActive: true }, select: { id: true, name: true } });
        
        let coaches: { id: string, name: string }[] = [];
        if (programManagerId) {
            coaches = await prisma.user.findMany({ where: { role: { in: COACH_LEVEL }, managerId: String(programManagerId), accountStatus: 'ACTIVE', isActive: true }, select: { id: true, name: true } });
        }

        const pathways = await prisma.pathway.findMany({ where: { isActive: true }, select: { id: true, name: true } });

        let classes: { id: string, name: string, instructorName: string }[] = [];
        if (pathwayId) {
            const rawClasses = await prisma.classModel.findMany({ where: { pathwayId: String(pathwayId), isActive: true }, include: { instructor: true } });
            classes = rawClasses.map(c => ({ id: c.id, name: c.name, instructorName: c.instructor?.name || 'Unassigned' }));
        }

        res.json({ pms, coaches, pathways, classes });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/signup', async (req, res) => {
    try {
        const { name, email, password, programManagerId, coachId, pathwayId, classIds } = req.body;
        const normalizedEmail = requiredString(email, 'email', 256).toLowerCase();
        const cleanName = requiredString(name, 'name', 128);
        const cleanClassIds = uniqueStrings(classIds, 'classIds', 20);

        if (!password || String(password).length < 8) {
            return res.status(400).json({ error: 'Valid name, email, and password (min 8 chars) required.' });
        }
        if (!programManagerId || !coachId || !pathwayId || cleanClassIds.length === 0) {
            return res.status(400).json({ error: 'Program manager, coach, pathway, and at least one class are required.' });
        }

        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) return res.status(400).json({ error: 'Email already in use' });

        const [pm, coach, pathway, classes] = await Promise.all([
            prisma.user.findUnique({ where: { id: String(programManagerId) } }),
            prisma.user.findUnique({ where: { id: String(coachId) } }),
            prisma.pathway.findUnique({ where: { id: String(pathwayId) } }),
            prisma.classModel.findMany({ where: { id: { in: cleanClassIds } } })
        ]);

        if (!pm || pm.role !== 'PROGRAM_MANAGER' || pm.accountStatus !== 'ACTIVE' || !pm.isActive) {
            return res.status(400).json({ error: 'Invalid PM selected' });
        }
        if (!coach || !isCoachLevel(coach.role) || coach.accountStatus !== 'ACTIVE' || !coach.isActive || coach.managerId !== pm.id) {
            return res.status(400).json({ error: 'Invalid coach selected' });
        }
        if (!pathway || !pathway.isActive) {
            return res.status(400).json({ error: 'Invalid pathway selected' });
        }
        if (classes.length !== cleanClassIds.length || classes.some((cls) => !cls.isActive || cls.pathwayId !== pathway.id)) {
            return res.status(400).json({ error: 'Invalid class selection' });
        }

        // Create the Supabase auth identity first (role in app_metadata), then
        // mirror the student + profile into Postgres using the Supabase user id.
        const supabaseUserId = await provisionSupabaseAuthUser({
            email: normalizedEmail, password: String(password), name: cleanName, role: 'STUDENT',
        });

        const student = await prisma.$transaction(async (tx) => {
             const user = await tx.user.create({
                 data: {
                     id: supabaseUserId,
                     name: cleanName, email: normalizedEmail, password: '',
                     role: 'STUDENT', accountStatus: 'ACTIVE'
                 }
             });

             const profile = await tx.studentProfile.create({
                 data: {
                     userId: user.id,
                     programManagerId: pm.id,
                     coachId: coach.id,
                     pathwayId: pathway.id
                 }
             });

             await tx.studentClassEnrollment.createMany({
                data: cleanClassIds.map(cid => ({ classId: cid, studentProfileId: profile.id }))
             });
             
             return user;
        });

        res.json({
          success: true,
          user: { id: student.id, email: student.email, name: student.name, role: student.role }
        });
    } catch(e: any) {
        res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error during signup' });
    }
});

router.post('/reports', authMiddleware, roleMiddleware(['STUDENT']), async (req, res) => {
    try {
        const payload = req.body;
        const studentId = (req as any).user?.id;
        
        const profile = await prisma.studentProfile.findUnique({
            where: { userId: studentId },
            include: { classEnrollments: { where: { isActive: true } } }
        });
        if (!profile) return res.status(400).json({ error: 'Student profile not found' });

        const cycle = await prisma.reportCycle.findFirst({
            where: {
                status: 'OPEN',
                OR: [ { pathwayId: profile.pathwayId }, { pathwayId: null } ],
            },
            orderBy: { createdAt: 'desc' }
        });
        
        if (!cycle) {
            return res.status(400).json({ error: 'No open report cycle is available.' });
        }

        const requestedStatus = requiredString(payload.status, 'status', 16);
        if (!REPORT_STATUSES_FROM_STUDENT.has(requestedStatus)) {
            return res.status(400).json({ error: 'Students can only save DRAFT or SUBMITTED reports.' });
        }

        const existingReport = await prisma.weeklyReport.findUnique({
            where: { studentId_cycleId: { studentId, cycleId: cycle.id } }
        });
        if (existingReport && existingReport.status !== 'DRAFT') {
            return res.status(409).json({ error: 'Submitted or reviewed reports can no longer be edited.' });
        }

        let challengeTags: string[] = [];
        if (typeof payload.challengesTags === 'string') {
            try {
                challengeTags = JSON.parse(payload.challengesTags);
            } catch {
                return res.status(400).json({ error: 'challengesTags must be valid JSON' });
            }
        } else if (payload.challengesTags !== undefined) {
            challengeTags = payload.challengesTags;
        }
        challengeTags = uniqueStrings(challengeTags, 'challengesTags', 10).map((tag) => {
            if (tag.length > 64) throw httpError(400, 'challenge tag is too long');
            return tag;
        });

        const ratingPayloads = payload.classRatings === undefined ? [] : payload.classRatings;
        if (!Array.isArray(ratingPayloads)) throw httpError(400, 'classRatings must be an array');

        const enrolledClassIds = new Set(profile.classEnrollments.map((enrollment) => enrollment.classId));
        const classRatings = new Map<string, { classId: string; rating: string; comment: string | null }>();
        for (const rating of ratingPayloads) {
            if (!rating || typeof rating !== 'object') throw httpError(400, 'Invalid class rating');
            const classId = requiredString((rating as any).classId, 'classId', 128);
            const value = requiredString((rating as any).rating, 'rating', 32);
            if (!enrolledClassIds.has(classId)) throw httpError(403, 'Cannot rate a class you are not enrolled in');
            if (!PERFORMANCE_LEVELS.has(value)) throw httpError(400, 'Invalid class rating value');
            classRatings.set(classId, {
                classId,
                rating: value,
                comment: optionalString((rating as any).comment, 'class rating comment', 1000)
            });
        }

        const answerPayloads = payload.targetedAnswers === undefined ? [] : payload.targetedAnswers;
        if (!Array.isArray(answerPayloads)) throw httpError(400, 'targetedAnswers must be an array');

        const targetedAnswers = answerPayloads.map((answer: any) => ({
            questionId: requiredString(answer?.questionId, 'questionId', 128),
            answer: requiredString(answer?.answer, 'targeted answer', 4000)
        }));
        const targetedQuestionIds = [...new Set(targetedAnswers.map((answer) => answer.questionId))];
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
            status: requestedStatus,
            submittedAt: requestedStatus === 'SUBMITTED' ? new Date() : null,
            energy: optionalInt(payload.energy, 'energy', 1, 10, 5),
            mood: optionalInt(payload.mood, 'mood', 1, 10, 5),
            attendance: optionalInt(payload.attendance, 'attendance', 0, 100, 100),
            confidence: optionalInt(payload.confidence, 'confidence', 1, 10, 5),
            weeklyTopic: optionalString(payload.weeklyTopic, 'weeklyTopic', 256),
            highlights: optionalString(payload.highlights, 'highlights', 5000),
            academicProgress: optionalString(payload.academicProgress, 'academicProgress', 5000),
            classExperience: optionalString(payload.classExperience, 'classExperience', 5000),
            instructorSupport: optionalString(payload.instructorSupport, 'instructorSupport', 2000),
            events: optionalString(payload.events, 'events', 2000),
            upcomingEvents: optionalString(payload.upcomingEvents, 'upcomingEvents', 2000),
            challengesTags: JSON.stringify(challengeTags),
            challengesText: optionalString(payload.challengesText, 'challengesText', 5000),
            needsSupport: !!payload.needsSupport,
            supportNeeded: optionalString(payload.supportNeeded, 'supportNeeded', 2000),
            reflection: optionalString(payload.reflection, 'reflection', 5000),
            goals: optionalString(payload.goals, 'goals', 2000)
        };

        const report = await prisma.$transaction(async (tx) => {
            const savedReport = await tx.weeklyReport.upsert({
                where: {
                    studentId_cycleId: { studentId, cycleId: cycle.id }
                },
                update: reportData,
                create: {
                    studentId,
                    cycleId: cycle.id,
                    ...reportData
                }
            });

            for (const ans of targetedAnswers) {
                await tx.targetedAnswer.upsert({
                        where: {
                            questionId_reportId: {
                                questionId: ans.questionId,
                                reportId: savedReport.id
                            }
                        },
                        update: { answer: ans.answer, studentId },
                        create: {
                            questionId: ans.questionId,
                            reportId: savedReport.id,
                            studentId,
                            answer: ans.answer
                        }
                });
            }

            await tx.classRating.deleteMany({ where: { reportId: savedReport.id } });
            const classRatingData = [...classRatings.values()].map((rating) => ({
                reportId: savedReport.id,
                ...rating
            }));
            if (classRatingData.length > 0) {
                await tx.classRating.createMany({ data: classRatingData });
            }

            return savedReport;
        });

        if (requestedStatus === 'SUBMITTED') {
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
                    await prisma.alert.create({
                        data: { studentId, type, severity, description }
                    });
                }
            };

            if (reportData.energy < thresholdEnergy) await createAlertIfNew('LOW_ENERGY', 'MEDIUM', 'Student reported low energy');
            if (reportData.mood < thresholdMood) await createAlertIfNew('LOW_MOOD', 'MEDIUM', 'Student reported low mood');
            if (reportData.attendance < thresholdAttend) await createAlertIfNew('LOW_ATTENDANCE', 'HIGH', 'Attendance dropped below threshold');
            if (reportData.confidence < thresholdConf) await createAlertIfNew('LOW_CONFIDENCE', 'MEDIUM', 'Student reported low confidence');
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
    } catch(e: any) {
        res.status(e.status || 500).json({ error: e.message || 'Server error' });
    }
});
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = requiredString(email, 'email', 256).toLowerCase();
    if (!password || typeof password !== 'string') {
      return authError(res, 401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }
    console.log(`[LOGIN ATTEMPT] Email: ${normalizedEmail}`);

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    
    if (!user) {
      console.log(`[LOGIN FAILED] User not found: ${email}`);
      return authError(res, 401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }

    if (user.accountStatus !== 'ACTIVE' || !user.isActive) {
      console.log(`[LOGIN FAILED] User inactive or pending: ${email}, status: ${user.accountStatus}`);
      return authError(res, 401, 'ACCOUNT_INACTIVE', 'Account is not active');
    }

    if (!user.password || !user.password.startsWith('$2')) {
      console.log(`[LOGIN FAILED] Missing or invalid bcrypt password hash for: ${email}`);
      return authError(res, 401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      console.log(`[LOGIN FAILED] Wrong password for: ${email}`);
      return authError(res, 401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '1d' });
    
    console.log(`[LOGIN SUCCESS] User: ${user.name} (${user.role})`);
    res.cookie('token', token, getCookieOptions(req));

    await prisma.auditLog.create({
      data: {
        actorId: user.id, actorRole: user.role, action: 'LOGIN',
        entityType: 'User', entityId: user.id, description: 'User login'
      }
    });

    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err: any) {
    console.error('[LOGIN ERROR]', err);
    res.status(err.status || 500).json({
      code: err.status ? 'LOGIN_VALIDATION_ERROR' : 'LOGIN_SERVER_ERROR',
      error: err.status ? err.message : 'Internal error'
    });
  }
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie('token', getCookieOptions(req));
  res.json({ success: true });
});

router.get('/auth/session', authMiddleware, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: (req as any).user.id }, select: { id: true, email: true, name: true, role: true } });
  if (!user) return res.status(401).json({ error: 'Invalid' });
  res.json({ user });
});

router.get('/dashboard-redirect', authMiddleware, (req: AuthRequest, res) => {
    switch ((req as any).user.role) {
        case 'DEV': return res.redirect('/admin');
        case 'ADMIN': return res.redirect('/admin');
        case 'PROGRAM_MANAGER': return res.redirect('/pm');
        case 'INSTRUCTOR': return res.redirect('/instructor');
        case 'COACH': return res.redirect('/coach');
        case 'PSM': return res.redirect('/coach');
        case 'STUDENT': return res.redirect('/student');
        case 'INTERN': return res.redirect('/student');
        default: return res.redirect('/');
    }
});

// --- ADMIN ---
router.get('/admin/invite', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
    try {
        const pms = await prisma.user.findMany({
            where: { role: 'PROGRAM_MANAGER' },
            select: { id: true, name: true, email: true, accountStatus: true, inviteToken: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(pms);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

import { generateDocx, generatePdf } from './exports.js';

router.get('/reports/export-docx', authMiddleware, async (req: any, res: any) => {
    try {
        const { id } = req.query;
        const report = await prisma.weeklyReport.findUnique({
            where: { id: String(id) },
            include: { student: { include: { studentProfile: { include: { classEnrollments: { include: { classModel: true } } } } } }, cycle: true, classRatings: true }
        });
        if (!report) return res.status(404).json({ error: 'Not found' });

        const reqUser = req.user;
        let authorized = false;
        if (isAdminLevel(reqUser.role)) authorized = true;
        else if (isStudentLevel(reqUser.role) && report.studentId === reqUser.id) authorized = true;
        else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
        else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;
        else if (reqUser.role === 'INSTRUCTOR') {
             const enrollments = report.student.studentProfile?.classEnrollments || [];
             authorized = enrollments.some(ce => ce.classModel?.instructorId === reqUser.id);
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
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/reports/export-pdf', authMiddleware, async (req: any, res: any) => {
    try {
        const { id } = req.query;
        const report = await prisma.weeklyReport.findUnique({
            where: { id: String(id) },
            include: { student: { include: { studentProfile: { include: { classEnrollments: { include: { classModel: true } } } } } }, cycle: true, classRatings: true }
        });
        if (!report) return res.status(404).json({ error: 'Not found' });

        const reqUser = req.user;
        let authorized = false;
        if (isAdminLevel(reqUser.role)) authorized = true;
        else if (isStudentLevel(reqUser.role) && report.studentId === reqUser.id) authorized = true;
        else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
        else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;
        else if (reqUser.role === 'INSTRUCTOR') {
             const enrollments = report.student.studentProfile?.classEnrollments || [];
             authorized = enrollments.some(ce => ce.classModel?.instructorId === reqUser.id);
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
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/register-staff', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req: any, res) => {
    try {
        const { name, email, password, role } = req.body;
        const normalizedEmail = requiredString(email, 'email', 256).toLowerCase();
        const cleanName = requiredString(name, 'name', 128);
        
        let newRole = role || 'PROGRAM_MANAGER';
        if (isAdminLevel(req.user.role)) {
            if (!['PROGRAM_MANAGER', 'COACH', 'PSM', 'INSTRUCTOR', 'INTERN'].includes(newRole)) {
                return res.status(400).json({ error: 'Invalid staff role' });
            }
        } else {
            if (!['COACH', 'PSM', 'INSTRUCTOR'].includes(newRole)) {
                return res.status(400).json({ error: 'Program Managers can only create coaches, PSMs or instructors' });
            }
        }

        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) return res.status(400).json({ error: 'User already exists' });

        if (!password || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        // Create the auth identity in Supabase (role authoritative in app_metadata),
        // then mirror it into Postgres using the Supabase user id.
        const supabaseUserId = await provisionSupabaseAuthUser({
            email: normalizedEmail, password, name: cleanName, role: newRole,
        });

        const user = await prisma.user.create({
            data: {
                id: supabaseUserId,
                name: cleanName,
                email: normalizedEmail,
                role: newRole,
                accountStatus: 'ACTIVE',
                isActive: true,
                password: '',
                managerId: req.user.role === 'PROGRAM_MANAGER' ? req.user.id : undefined
            }
        });
        
        await prisma.auditLog.create({
           data: { actorId: req.user?.id, actorRole: req.user?.role, action: 'CREATE', entityType: 'USER', entityId: user.id, description: `${isAdminLevel(req.user?.role) ? 'Admin' : 'Program Manager'} registered ${newRole} ${cleanName}` }
        });

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                accountStatus: user.accountStatus
            }
        });
    } catch(e: any) {
        console.error('REGISTER ERROR:', e);
        res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error: ' + (e.message || String(e)) });
    }
});

router.post('/admin/invite', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
    try {
        const name = requiredString(req.body.name, 'name', 128);
        const normalizedEmail = requiredString(req.body.email, 'email', 256).toLowerCase();
        
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) return res.status(400).json({ error: 'User already exists' });
        
        const inviteToken = crypto.randomBytes(16).toString('hex');
        
        const user = await prisma.user.create({
            data: {
                name,
                email: normalizedEmail,
                role: 'PROGRAM_MANAGER',
                accountStatus: 'INVITED',
                isActive: true,
                password: '',
                inviteToken
            }
        });
        
        await prisma.auditLog.create({
           data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'USER', entityId: user.id, description: `Admin invited Program Manager ${name}` }
        });

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                accountStatus: user.accountStatus
            },
            setupLink: `/setup-account?token=${inviteToken}`
        });
    } catch(e: any) {
        res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
    }
});

router.delete('/admin/invite', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
    try {
        const { id } = req.query;
        await prisma.user.update({
            where: { id: String(id) },
            data: { accountStatus: 'DEACTIVATED', isActive: false }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/analytics', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        if (req.user.role === 'PROGRAM_MANAGER') {
            const pmId = req.user.id;
            const totalStudents = await prisma.user.count({ where: { role: { in: STUDENT_LEVEL }, isActive: true, studentProfile: { programManagerId: pmId } } });
            const totalStaff = await prisma.user.count({ where: { isActive: true, managerId: pmId } });
            const cycle = await prisma.reportCycle.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
            const cycleFilter = cycle ? { cycleId: cycle.id, student: { studentProfile: { programManagerId: pmId } } } : undefined;
            const submittedReportsThisCycle = cycleFilter ? await prisma.weeklyReport.count({ where: { ...cycleFilter, status: 'SUBMITTED' } }) : 0;
            const reviewedReportsThisCycle = cycleFilter ? await prisma.weeklyReport.count({ where: { ...cycleFilter, status: 'REVIEWED' } }) : 0;
            const activeAlerts = await prisma.alert.count({ where: { resolved: false, student: { studentProfile: { programManagerId: pmId } } } });
            const needsSupportReports = await prisma.weeklyReport.findMany({
                where: { needsSupport: true, student: { studentProfile: { programManagerId: pmId } } },
                select: { studentId: true }
            });

            return res.json({
                totalStudents,
                totalActiveUsers: totalStudents + totalStaff + 1,
                totalProgramManagers: 1,
                totalPathways: await prisma.pathway.count({ where: { isActive: true, studentProfiles: { some: { programManagerId: pmId } } } }),
                totalClasses: 0,
                submittedReportsThisCycle,
                submissionRate: totalStudents > 0 ? Math.round(((submittedReportsThisCycle + reviewedReportsThisCycle) / totalStudents) * 100) : 0,
                reviewedRate: submittedReportsThisCycle > 0 ? Math.round((reviewedReportsThisCycle / submittedReportsThisCycle) * 100) : 0,
                overdueReports: 0,
                studentsNeedingSupport: new Set(needsSupportReports.map((report) => report.studentId)).size,
                activeAlerts,
                alertDistribution: [],
                classPerformance: { overall: {}, byPathway: [] },
                submissionTrend: [],
                recentActivity: []
            });
        }

        const totalStudents = await prisma.user.count({ where: { role: { in: STUDENT_LEVEL }, isActive: true } });
        const totalActiveUsers = await prisma.user.count({ where: { isActive: true } });
        
        let cycle = await prisma.reportCycle.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
        let submissionRate = 0;
        let reviewedRate = 0;
        let studentsNeedingSupport = 0;

        if (cycle) {
            const submittedCount = await prisma.weeklyReport.count({ where: { cycleId: cycle.id, status: 'SUBMITTED' } });
            const reviewedCount = await prisma.weeklyReport.count({ where: { cycleId: cycle.id, status: 'REVIEWED' } });
            if (totalStudents > 0) submissionRate = Math.round((submittedCount / totalStudents) * 100);
            if (submittedCount > 0) reviewedRate = Math.round((reviewedCount / submittedCount) * 100);
        }

        const openCyclesPastDue = await prisma.reportCycle.count({ where: { status: 'OPEN', endDate: { lt: new Date() } } });
        const overdueReports = openCyclesPastDue * totalStudents;

        const needsSupportReports = await prisma.weeklyReport.findMany({ where: { needsSupport: true }, select: { studentId: true } });
        studentsNeedingSupport = new Set(needsSupportReports.map(r => r.studentId)).size;

        const activeAlertsCount = await prisma.alert.count({ where: { resolved: false } });

        const typeGroups = await prisma.alert.groupBy({ by: ['type'], _count: { id: true } });
        const alertDistribution = typeGroups.map(g => ({ type: g.type, count: g._count.id }));

        const recentActivity = await prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        // Submission trend (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const trend = await prisma.weeklyReport.groupBy({
            by: ['createdAt'],
            _count: { id: true },
            where: { createdAt: { gte: sevenDaysAgo } },
            orderBy: { createdAt: 'asc' }
        });
        const submissionTrend = trend.map(t => ({ date: t.createdAt.toISOString().split('T')[0], count: t._count.id }));

        // Class performance aggregation
        const allRatings = await prisma.classRating.findMany();
        const performance = {
            EXCEEDING: allRatings.filter(r => r.rating === 'EXCEEDING').length,
            MEETING: allRatings.filter(r => r.rating === 'MEETING').length,
            APPROACHING: allRatings.filter(r => r.rating === 'APPROACHING').length,
            BEGINNING: allRatings.filter(r => r.rating === 'BEGINNING').length,
        };

        res.json({
            totalStudents,
            totalActiveUsers,
            totalProgramManagers: await prisma.user.count({ where: { role: 'PROGRAM_MANAGER', isActive: true } }),
            totalPathways: await prisma.pathway.count({ where: { isActive: true } }),
            totalClasses: await prisma.classModel.count({ where: { isActive: true } }),
            submittedReportsThisCycle: cycle ? await prisma.weeklyReport.count({ where: { cycleId: cycle.id, status: 'SUBMITTED' } }) : 0,
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
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/pathways', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const pathways = await prisma.pathway.findMany({
            where: { isActive: true },
            include: {
                _count: {
                    select: { classes: true, studentProfiles: true }
                }
            }
        });
        const mapped = pathways.map(p => ({
            ...p,
            classesCount: p._count.classes,
            studentsCount: p._count.studentProfiles,
            instructorsCount: 0 // Simplification since instructor works slightly differently
        }));
        res.json(mapped);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/pathways', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { name, description } = req.body;
        const pathway = await prisma.pathway.create({
            data: { name, description }
        });
        await prisma.auditLog.create({
            data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'Pathway', entityId: pathway.id, description: `Created pathway ${name}` }
        });
        res.json(pathway);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/admin/pathways', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { id } = req.query;
        await prisma.pathway.update({
            where: { id: String(id) },
            data: { isActive: false }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/users', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const where = req.user.role === 'PROGRAM_MANAGER'
            ? {
                OR: [
                    { managerId: req.user.id },
                    { studentProfile: { programManagerId: req.user.id } }
                ]
            }
            : {};
        const users = await prisma.user.findMany({
            where,
            select: { id: true, name: true, email: true, role: true, accountStatus: true },
            orderBy: { name: 'asc' }
        });
        res.json(users);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/users', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req: any, res: any) => {
    // Just map to PM invite for now or handle appropriately
    return res.status(400).json({ error: 'Use PM Invite instead' });
});

router.patch('/admin/users/:id', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        
        const targetUser = await prisma.user.findUnique({ where: { id: String(id) }, include: { studentProfile: true } });
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        
        if (req.user.role === 'PROGRAM_MANAGER') {
            const managesStaff = targetUser.managerId === req.user.id;
            const managesStudent = targetUser.studentProfile?.programManagerId === req.user.id;
            if (!managesStaff && !managesStudent) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        if (req.user.role === 'PROGRAM_MANAGER' && (isAdminLevel(targetUser.role) || targetUser.role === 'PROGRAM_MANAGER')) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        await prisma.user.update({
            where: { id: String(id) },
            data: { isActive, accountStatus: isActive ? 'ACTIVE' : 'DEACTIVATED' }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/settings', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        let settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
        if (!settings) {
            settings = await prisma.appSettings.create({ data: { id: 'singleton' } });
        }
        res.json(settings);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/admin/settings', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const data = req.body;
        const updated = await prisma.appSettings.upsert({
            where: { id: 'singleton' },
            create: {
               id: 'singleton',
               organizationName: data.organizationName,
               productName: data.productName,
               primaryColor: data.primaryColor,
               weeklyDueDay: data.weeklyDueDay !== undefined ? parseInt(data.weeklyDueDay) : undefined,
               weeklyDueHour: data.weeklyDueHour !== undefined ? parseInt(data.weeklyDueHour) : undefined,
               autoCloseCycles: data.autoCloseCycles,
               alertThresholdEnergy: data.alertThresholdEnergy !== undefined ? parseInt(data.alertThresholdEnergy) : undefined,
               alertThresholdMood: data.alertThresholdMood !== undefined ? parseInt(data.alertThresholdMood) : undefined,
               alertThresholdAttend: data.alertThresholdAttend !== undefined ? parseInt(data.alertThresholdAttend) : undefined,
               alertThresholdConf: data.alertThresholdConf !== undefined ? parseInt(data.alertThresholdConf) : undefined,
               outlookEnabled: data.outlookEnabled,
               brightspaceEnabled: data.brightspaceEnabled
            },
            update: {
               organizationName: data.organizationName,
               productName: data.productName,
               primaryColor: data.primaryColor,
               weeklyDueDay: data.weeklyDueDay !== undefined ? parseInt(data.weeklyDueDay) : undefined,
               weeklyDueHour: data.weeklyDueHour !== undefined ? parseInt(data.weeklyDueHour) : undefined,
               autoCloseCycles: data.autoCloseCycles,
               alertThresholdEnergy: data.alertThresholdEnergy !== undefined ? parseInt(data.alertThresholdEnergy) : undefined,
               alertThresholdMood: data.alertThresholdMood !== undefined ? parseInt(data.alertThresholdMood) : undefined,
               alertThresholdAttend: data.alertThresholdAttend !== undefined ? parseInt(data.alertThresholdAttend) : undefined,
               alertThresholdConf: data.alertThresholdConf !== undefined ? parseInt(data.alertThresholdConf) : undefined,
               outlookEnabled: data.outlookEnabled,
               brightspaceEnabled: data.brightspaceEnabled
            }
        });
        
        await prisma.auditLog.create({
            data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'UPDATE', entityType: 'Settings', entityId: 'singleton', description: 'Updated app settings' }
        });
        res.json(updated);
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/classes', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const classes = await prisma.classModel.findMany({
            where: { isActive: true },
            include: { pathway: true, instructor: true }
        });
        res.json(omitSensitive(classes));
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/classes', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { name, pathwayId, instructorId, schedule } = req.body;
        const cls = await prisma.classModel.create({
            data: { name, pathwayId, instructorId, schedule }
        });
        await prisma.auditLog.create({
            data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'Class', entityId: cls.id, description: `Created class ${name}` }
        });
        res.json(cls);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/admin/classes', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { id } = req.query;
        await prisma.classModel.update({
            where: { id: String(id) },
            data: { isActive: false }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/instructors', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const instructors = await prisma.user.findMany({
            where: { role: 'INSTRUCTOR', isActive: true },
            select: { id: true, name: true }
        });
        res.json(instructors);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/communities', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const communities = await prisma.community.findMany({
            where: { isActive: true },
            include: { programManager: true, _count: { select: { studentProfiles: true } } }
        });
        res.json(omitSensitive(communities.map(c => ({...c, studentsCount: c._count.studentProfiles}))));
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/communities', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { name, description, programManagerId } = req.body;
        const comm = await prisma.community.create({
            data: { name, description, programManagerId }
        });
        await prisma.auditLog.create({
            data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'Community', entityId: comm.id, description: `Created community: ${comm.name}` }
        });
        res.json(comm);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/admin/communities', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { id } = req.query;
        await prisma.community.update({
            where: { id: String(id) },
            data: { isActive: false }
        });
        await prisma.auditLog.create({
            data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'DELETE', entityType: 'Community', entityId: String(id), description: `Deactivated community` }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/cycles', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const cycles = await prisma.reportCycle.findMany({
            include: { pathway: true, _count: { select: { weeklyReports: true } } }
        });
        res.json(cycles.map(c => ({...c, reportsCount: c._count.weeklyReports})));
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/cycles', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { name, startDate, endDate, status, pathwayId } = req.body;
        
        if (status === 'OPEN') {
            const hasOpen = await prisma.reportCycle.findFirst({
                where: { status: 'OPEN', pathwayId }
            });
            if (hasOpen) return res.status(400).json({ error: 'An OPEN cycle already exists for this scope' });
        }
        
        const cycle = await prisma.reportCycle.create({
            data: { name, startDate: new Date(startDate), endDate: new Date(endDate), status, pathwayId }
        });
        await prisma.auditLog.create({
            data: { actorId: (req as any).user?.id, actorRole: (req as any).user?.role, action: 'CREATE', entityType: 'ReportCycle', entityId: cycle.id, description: `Created cycle: ${cycle.name}` }
        });
        res.json(cycle);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/admin/cycles/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (status === 'OPEN') {
             const cycle = await prisma.reportCycle.findUnique({ where: { id: String(id) }});
             const hasOpen = await prisma.reportCycle.findFirst({
                 where: { status: 'OPEN', pathwayId: cycle?.pathwayId }
             });
             if (hasOpen && hasOpen.id !== id) return res.status(400).json({ error: 'An OPEN cycle already exists' });
        }
        
        await prisma.reportCycle.update({
            where: { id: String(id) },
            data: { status }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/audit', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const logs = await prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        res.json(logs);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/targeted-questions', authMiddleware, async (req: any, res: any) => {
    try {
        const where: any = { isActive: true };
        if (isStudentLevel(req.user.role)) {
            where.studentId = req.user.id;
        } else if (req.user.role === 'PROGRAM_MANAGER') {
            const students = await prisma.user.findMany({
                where: { role: { in: STUDENT_LEVEL }, studentProfile: { programManagerId: req.user.id } },
                select: { id: true }
            });
            where.studentId = { in: students.map((student) => student.id) };
        } else if (isCoachLevel(req.user.role)) {
            const students = await prisma.user.findMany({
                where: { role: { in: STUDENT_LEVEL }, studentProfile: { coachId: req.user.id } },
                select: { id: true }
            });
            where.studentId = { in: students.map((student) => student.id) };
        } else if (!isAdminLevel(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const questions = await prisma.targetedQuestion.findMany({
            where,
            include: { cycle: true }
        });
        res.json(questions);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/targeted-questions', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const question = requiredString(req.body.question, 'question', 1000);
        const studentId = requiredString(req.body.studentId, 'studentId', 128);
        const cycleId = req.body.cycleId ? requiredString(req.body.cycleId, 'cycleId', 128) : null;
        const student = await prisma.user.findUnique({
            where: { id: studentId },
            include: { studentProfile: true }
        });
        if (!student || !isStudentLevel(student.role) || !student.isActive || student.accountStatus !== 'ACTIVE') {
            return res.status(400).json({ error: 'Invalid student selected' });
        }
        
        if (req.user.role === 'PROGRAM_MANAGER') {
            if (student?.studentProfile?.programManagerId !== req.user.id) {
                return res.status(403).json({ error: 'Unauthorized to target this student' });
            }
        }
        
        const created = await prisma.targetedQuestion.create({
            data: { question, studentId, cycleId, creatorId: req.user.id }
        });
        res.json(created);
    } catch(e: any) {
        res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
    }
});

router.delete('/targeted-questions', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const { id } = req.query;
        const q = await prisma.targetedQuestion.findUnique({ where: { id: String(id) } });
        if (!q) return res.status(404).json({ error: 'Not found' });
        
        if (req.user.role === 'PROGRAM_MANAGER' && q.creatorId !== req.user.id) {
            return res.status(403).json({ error: 'Unauthorized to delete this question' });
        }

        await prisma.targetedQuestion.update({
            where: { id: String(id) },
            data: { isActive: false }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/pm/dashboard', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req, res) => {
    try {
        const students = await prisma.user.findMany({
            where: { role: { in: STUDENT_LEVEL }, studentProfile: { programManagerId: (req as any).user?.id } },
            include: { weeklyReports: { where: { status: { in: ['SUBMITTED', 'REVIEWED'] } } } }
        });
        const alerts = await prisma.alert.findMany({
            where: { resolved: false, student: { studentProfile: { programManagerId: (req as any).user?.id } } },
            include: { student: true }
        });
        const studentsWithReports = students.map(s => omitSensitive({
            ...s,
            reports: s.weeklyReports
        }));
        res.json({ students: studentsWithReports, alerts: omitSensitive(alerts) });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/student/reports', authMiddleware, roleMiddleware(['STUDENT']), async (req, res) => {
    try {
        const reports = await prisma.weeklyReport.findMany({
            where: { studentId: (req as any).user?.id },
            include: { cycle: true },
            orderBy: { submittedAt: 'desc' }
        });
        res.json(reports);
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/reports/:id', authMiddleware, async (req: any, res: any) => {
    try {
        const report = await prisma.weeklyReport.findUnique({
            where: { id: req.params.id },
            include: {
                student: { include: { studentProfile: { include: { coach: true, programManager: true, pathway: true, classEnrollments: { include: { classModel: true } } } } } },
                cycle: true,
                classRatings: { include: { classModel: true } },
                targetedAnswers: { include: { question: true } },
                coachFeedback: { include: { coach: true } }
            }
        });
        if (!report) return res.status(404).json({ error: 'Report not found' });

        const reqUser = req.user;
        let authorized = false;
        if (isAdminLevel(reqUser.role)) authorized = true;
        else if (isStudentLevel(reqUser.role) && report.studentId === reqUser.id) authorized = true;
        else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
        else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;
        else if (reqUser.role === 'INSTRUCTOR') {
             const enrollments = report.student.studentProfile?.classEnrollments || [];
             authorized = enrollments.some((ce:any) => ce.classModel?.instructorId === reqUser.id);
        }

        if (!authorized) return res.status(403).json({ error: 'Unauthorized' });

        res.json(omitSensitive(report));
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/reports/:id/review', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER', 'COACH']), async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const report = await prisma.weeklyReport.findUnique({
            where: { id },
            include: { student: { include: { studentProfile: true } } }
        });
        if (!report) return res.status(404).json({ error: 'Report not found' });

        if (report.status !== 'SUBMITTED') {
            return res.status(400).json({ error: 'Only submitted reports can be marked as reviewed' });
        }

        const reqUser = req.user;
        let authorized = false;
        if (isAdminLevel(reqUser.role)) authorized = true;
        else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
        else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;

        if (!authorized) return res.status(403).json({ error: 'Unauthorized to review this report' });

        await prisma.weeklyReport.update({
            where: { id },
            data: { status: 'REVIEWED' }
        });
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/admin/reports', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
    try {
        const reqUser = (req as any).user;
        const where = reqUser.role === 'PROGRAM_MANAGER'
            ? { status: { in: ['SUBMITTED', 'REVIEWED'] }, student: { studentProfile: { programManagerId: reqUser.id } } }
            : { status: { in: ['SUBMITTED', 'REVIEWED'] } };
        const reports = await prisma.weeklyReport.findMany({
            where,
            include: { student: true, cycle: true },
            orderBy: { submittedAt: 'desc' }
        });
        res.json(omitSensitive(reports));
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/coach/dashboard', authMiddleware, roleMiddleware(['COACH']), async (req, res) => {
    try {
        const students = await prisma.user.findMany({
            where: { role: { in: STUDENT_LEVEL }, studentProfile: { coachId: (req as any).user?.id } },
            select: { id: true, name: true, email: true, role: true, accountStatus: true, isActive: true, createdAt: true }
        });
        const reports = await prisma.weeklyReport.findMany({
            where: {
                student: { studentProfile: { coachId: (req as any).user?.id } },
                status: { in: ['SUBMITTED', 'REVIEWED'] }
            },
            include: { student: true }
        });
        res.json({ students, reports: omitSensitive(reports) });
    } catch(e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ======== STUDENT ========
router.get('/student/me', authMiddleware, roleMiddleware(['STUDENT']), async (req: any, res: any) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { studentProfile: { include: { programManager: true, coach: true, pathway: true, classEnrollments: { include: { classModel: true } } } } }
        });
        const cycleScope = user?.studentProfile?.pathwayId
            ? [{ pathwayId: user.studentProfile.pathwayId }, { pathwayId: null }]
            : [{ pathwayId: null }];
        const openCycle = await prisma.reportCycle.findFirst({
            where: {
                status: 'OPEN',
                OR: cycleScope
            },
            orderBy: { createdAt: 'desc' }
        });
        let currentReport = null;
        if (openCycle) {
            currentReport = await prisma.weeklyReport.findFirst({ where: { studentId: req.user.id, cycleId: openCycle.id } });
        }
        res.json(omitSensitive({ ...user, currentCycle: openCycle, currentReport }));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/student/classes', authMiddleware, roleMiddleware(['STUDENT']), async (req: any, res: any) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { studentProfile: { include: { classEnrollments: { include: { classModel: { include: { instructor: true } } } } } } } });
        res.json(omitSensitive(user?.studentProfile?.classEnrollments.map((e: any) => e.classModel) || []));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/student/history', authMiddleware, roleMiddleware(['STUDENT']), async (req: any, res: any) => {
    try {
        const reports = await prisma.weeklyReport.findMany({
            where: { studentId: req.user.id },
            include: { cycle: true, classRatings: { include: { classModel: true } } },
            orderBy: { submittedAt: 'desc' }
        });
        res.json(reports);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ======== COACH ========
router.get('/coach/students', authMiddleware, roleMiddleware(['COACH']), async (req: any, res: any) => {
    try {
        const students = await prisma.user.findMany({
            where: { role: { in: STUDENT_LEVEL }, studentProfile: { coachId: req.user.id } },
            include: { studentProfile: { include: { pathway: true } } }
        });
        res.json(omitSensitive(students));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/coach/reports', authMiddleware, roleMiddleware(['COACH']), async (req: any, res: any) => {
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
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/coach/alerts', authMiddleware, roleMiddleware(['COACH']), async (req: any, res: any) => {
    try {
        const alerts = await prisma.alert.findMany({
            where: { resolved: false, student: { studentProfile: { coachId: req.user.id } } },
            include: { student: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(omitSensitive(alerts));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/alerts/:id/resolve', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER', 'COACH']), async (req: any, res: any) => {
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
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ======== INSTRUCTOR ========
router.get('/instructor/dashboard', authMiddleware, roleMiddleware(['INSTRUCTOR']), async (req: any, res: any) => {
    try {
        const classes = await prisma.classModel.findMany({ where: { instructorId: req.user.id, isActive: true }, include: { _count: { select: { studentClassEnrollments: true } } } });
        const ratings = await prisma.classRating.findMany({ where: { classModel: { instructorId: req.user.id } }, include: { classModel: true } });
        res.json({ classes, ratings });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/instructor/classes', authMiddleware, roleMiddleware(['INSTRUCTOR']), async (req: any, res: any) => {
    try {
        const classes = await prisma.classModel.findMany({ where: { instructorId: req.user.id, isActive: true }, include: { studentClassEnrollments: { include: { studentProfile: { include: { user: true } } } } } });
        res.json(omitSensitive(classes));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/instructor/reports', authMiddleware, roleMiddleware(['INSTRUCTOR']), async (req: any, res: any) => {
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
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ======== PM ========
router.get('/pm/students', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const students = await prisma.user.findMany({ where: { role: { in: STUDENT_LEVEL }, studentProfile: { programManagerId: req.user.id } }, include: { studentProfile: { include: { pathway: true, coach: true } } } });
        res.json(omitSensitive(students));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/pm/staff', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const staff = await prisma.user.findMany({
            where: { role: { in: ['COACH', 'PSM', 'INSTRUCTOR'] }, managerId: req.user.id, isActive: true },
            select: { id: true, name: true, email: true, role: true, accountStatus: true, isActive: true, createdAt: true }
        });
        res.json(staff);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/pm/staff', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const { role } = req.body;
        const name = requiredString(req.body.name, 'name', 128);
        const normalizedEmail = requiredString(req.body.email, 'email', 256).toLowerCase();
        
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) return res.status(400).json({ error: 'User already exists' });

        if (role !== 'COACH' && role !== 'PSM' && role !== 'INSTRUCTOR') {
            return res.status(400).json({ error: 'Invalid role for PM to invite' });
        }
        
        const inviteToken = crypto.randomBytes(16).toString('hex');
        const user = await prisma.user.create({
            data: {
                name,
                email: normalizedEmail,
                role,
                accountStatus: 'INVITED',
                isActive: true,
                password: '',
                inviteToken,
                managerId: req.user.id
            }
        });

        await prisma.auditLog.create({
            data: { actorId: req.user.id, actorRole: req.user.role, action: 'CREATE', entityType: 'User', entityId: user.id, description: `PM invited ${role} ${name}` }
        });

        res.json({ success: true, setupLink: `/setup-account?token=${inviteToken}` });
    } catch(e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); }
});

router.delete('/pm/staff', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const targetId = req.query.id as string;
        const target = await prisma.user.findUnique({ where: { id: targetId }, select: { managerId: true, role: true } });
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.managerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
        await prisma.user.update({ where: { id: targetId }, data: { isActive: false, accountStatus: 'DEACTIVATED' } });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/pm/communities', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const communities = await prisma.community.findMany({
            where: { programManagerId: req.user.id },
            include: { programManager: { select: { id: true, name: true, email: true } } }
        });
        res.json(communities);
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/pm/communities', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        res.json(await prisma.community.create({ data: { name: req.body.name, programManagerId: req.user.id } }));
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/pm/communities', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const id = String(req.query.id || '');
        const community = await prisma.community.findUnique({ where: { id } });
        if (!community) return res.status(404).json({ error: 'Community not found' });
        if (community.programManagerId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
        await prisma.community.update({ where: { id }, data: { isActive: false } });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/pm/reports', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
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
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/pm/analytics', authMiddleware, roleMiddleware(['PROGRAM_MANAGER']), async (req: any, res: any) => {
    try {
        const pmId = req.user.id;
        const totalStudents = await prisma.user.count({ where: { role: { in: STUDENT_LEVEL }, isActive: true, studentProfile: { programManagerId: pmId } } });
        
        let cycle = await prisma.reportCycle.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' } });
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
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/reports/:id/feedback', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER', 'COACH']), async (req: any, res: any) => {
    try {
        const text = requiredString(req.body.text, 'feedback', 4000);
        const report = await prisma.weeklyReport.findUnique({
            where: { id: req.params.id },
            include: { student: { include: { studentProfile: true } } }
        });
        if (!report) return res.status(404).json({ error: 'Report not found' });

        const reqUser = req.user;
        let authorized = false;
        if (isAdminLevel(reqUser.role)) authorized = true;
        else if (isCoachLevel(reqUser.role) && report.student.studentProfile?.coachId === reqUser.id) authorized = true;
        else if (reqUser.role === 'PROGRAM_MANAGER' && report.student.studentProfile?.programManagerId === reqUser.id) authorized = true;

        if (!authorized) return res.status(403).json({ error: 'Unauthorized to give feedback on this report' });

        const feedback = await prisma.coachFeedback.create({
            data: {
                reportId: req.params.id,
                coachId: req.user.id,
                feedback: text
            }
        });
        res.json({ success: true, text, feedback });
    } catch(e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); }
});

const conductInclude = {
    student: { select: { id: true, name: true, email: true } },
    author: { select: { id: true, name: true, role: true } },
    reviewer: { select: { id: true, name: true } }
};

router.get('/conduct/students', authMiddleware, roleMiddleware(['ADMIN', 'INSTRUCTOR']), async (req: any, res: any) => {
    try {
        const where = isAdminLevel(req.user.role)
            ? { role: { in: STUDENT_LEVEL }, isActive: true }
            : {
                role: { in: STUDENT_LEVEL }, isActive: true,
                studentProfile: { classEnrollments: { some: { isActive: true, classModel: { instructorId: req.user.id } } } }
            };
        const students = await prisma.user.findMany({ where, select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } });
        res.json(students);
    } catch (e) { res.status(500).json({ error: 'Unable to load students' }); }
});

router.get('/conduct', authMiddleware, roleMiddleware(['ADMIN', 'INSTRUCTOR']), async (req: any, res: any) => {
    try {
        const where = isAdminLevel(req.user.role)
            ? {}
            : { student: { studentProfile: { classEnrollments: { some: { isActive: true, classModel: { instructorId: req.user.id } } } } } };
        const entries = await prisma.conductEntry.findMany({ where, include: conductInclude, orderBy: { createdAt: 'desc' }, take: 250 });
        res.json(entries);
    } catch (e) { res.status(500).json({ error: 'Unable to load conduct entries' }); }
});

router.post('/conduct', authMiddleware, roleMiddleware(['ADMIN', 'INSTRUCTOR']), async (req: any, res: any) => {
    try {
        const type = req.body.type;
        if (!['INFRACTION', 'CONVERSATION'].includes(type)) throw httpError(400, 'type must be INFRACTION or CONVERSATION');
        const studentId = requiredString(req.body.studentId, 'student', 128);
        const summary = requiredString(req.body.summary, 'summary', 2000);
        const followUp = requiredString(req.body.followUp, 'action or follow-up', 2000);
        const points = type === 'CONVERSATION' ? 0 : optionalInt(req.body.points, 'points', 1, 100, 0);
        if (type === 'INFRACTION' && points === 0) throw httpError(400, 'Infraction points must be between 1 and 100');

        const student = await prisma.user.findFirst({ where: { id: studentId, role: { in: STUDENT_LEVEL }, isActive: true }, include: { studentProfile: { include: { classEnrollments: { include: { classModel: true } } } } } });
        if (!student) throw httpError(404, 'Student not found');
        if (req.user.role === 'INSTRUCTOR' && !student.studentProfile?.classEnrollments.some((item) => item.isActive && item.classModel.instructorId === req.user.id)) {
            throw httpError(403, 'You can only log entries for students in your classes');
        }

        const approved = isAdminLevel(req.user.role) || type === 'CONVERSATION';
        const entry = await prisma.$transaction(async (tx) => {
            const created = await tx.conductEntry.create({ data: {
                studentId, authorId: req.user.id, type, points, summary, followUp,
                status: approved ? 'APPROVED' : 'PENDING',
                reviewerId: isAdminLevel(req.user.role) ? req.user.id : null,
                reviewedAt: isAdminLevel(req.user.role) ? new Date() : null
            }, include: conductInclude });
            await tx.auditLog.create({ data: { actorId: req.user.id, actorRole: req.user.role, action: 'CREATE', entityType: 'ConductEntry', entityId: created.id, description: `${type === 'INFRACTION' ? `${points}-point infraction` : 'Conversation note'} logged for ${student.name}` } });
            return created;
        });
        res.status(201).json(entry);
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Unable to create conduct entry' }); }
});

router.patch('/conduct/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req: any, res: any) => {
    try {
        const status = req.body.status;
        if (!['APPROVED', 'CLEARED'].includes(status)) throw httpError(400, 'status must be APPROVED or CLEARED');
        const existing = await prisma.conductEntry.findUnique({ where: { id: req.params.id }, include: { student: true } });
        if (!existing) throw httpError(404, 'Entry not found');
        const points = existing.type === 'CONVERSATION' ? 0 : optionalInt(req.body.points, 'points', 1, 100, existing.points);
        const entry = await prisma.$transaction(async (tx) => {
            const updated = await tx.conductEntry.update({ where: { id: existing.id }, data: { status, points, reviewerId: req.user.id, reviewedAt: new Date() }, include: conductInclude });
            await tx.auditLog.create({ data: { actorId: req.user.id, actorRole: req.user.role, action: status, entityType: 'ConductEntry', entityId: existing.id, description: `${status === 'CLEARED' ? 'Cleared' : 'Approved'} conduct entry for ${existing.student.name}${status === 'APPROVED' ? ` at ${points} points` : ''}` } });
            return updated;
        });
        res.json(entry);
    } catch (e: any) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Unable to review conduct entry' }); }
});

export default router;
