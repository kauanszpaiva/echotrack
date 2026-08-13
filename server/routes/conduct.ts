// Rotas de conduta (Conduct) - infrações e conversas
import { Router } from 'express';
import prisma from '../prisma.js';
import { authMiddleware, roleMiddleware } from '../auth.js';
import { isAdminLevel, isStudentLevel, STUDENT_LEVEL } from '../../shared/roles.js';
import { optionalInt, requiredString, httpError } from './helpers.js';

const router = Router();

const conductInclude = {
  student: { select: { id: true, name: true, email: true } },
  author: { select: { id: true, name: true, role: true } },
  reviewer: { select: { id: true, name: true } }
};

// Buscar estudantes para o condutor
router.get('/students', authMiddleware, roleMiddleware(['ADMIN', 'INSTRUCTOR']), async (req, res) => {
  try {
    const where = isAdminLevel((req as any).user.role)
      ? { role: { in: STUDENT_LEVEL }, isActive: true }
      : {
          role: { in: STUDENT_LEVEL }, isActive: true,
          studentProfile: { classEnrollments: { some: { isActive: true, classModel: { instructorId: (req as any).user.id } } } }
        };
    const students = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    });
    res.json(students);
  } catch (e) {
    res.status(500).json({ error: 'Unable to load students' });
  }
});

// Buscar entradas de conduta
router.get('/', authMiddleware, roleMiddleware(['ADMIN', 'INSTRUCTOR']), async (req, res) => {
  try {
    const where = isAdminLevel((req as any).user.role)
      ? {}
      : { student: { studentProfile: { classEnrollments: { some: { isActive: true, classModel: { instructorId: (req as any).user.id } } } } } };
    const entries = await prisma.conductEntry.findMany({
      where,
      include: conductInclude,
      orderBy: { createdAt: 'desc' },
      take: 250
    });
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: 'Unable to load conduct entries' });
  }
});

// Criar entrada de conduta
router.post('/', authMiddleware, roleMiddleware(['ADMIN', 'INSTRUCTOR']), async (req, res) => {
  try {
    const type = (req as any).body.type;
    if (!['INFRACTION', 'CONVERSATION'].includes(type)) {
      throw httpError(400, 'type must be INFRACTION or CONVERSATION');
    }
    const studentId = requiredString((req as any).body.studentId, 'student', 128);
    const summary = requiredString((req as any).body.summary, 'summary', 2000);
    const followUp = requiredString((req as any).body.followUp, 'action or follow-up', 2000);
    const points = type === 'CONVERSATION' ? 0 : optionalInt((req as any).body.points, 'points', 1, 100, 0);
    if (type === 'INFRACTION' && points === 0) {
      throw httpError(400, 'Infraction points must be between 1 and 100');
    }

    const student = await prisma.user.findFirst({
      where: { id: studentId, role: { in: STUDENT_LEVEL }, isActive: true },
      include: { studentProfile: { include: { classEnrollments: { include: { classModel: true } } } } }
    });
    if (!student) throw httpError(404, 'Student not found');
    if ((req as any).user.role === 'INSTRUCTOR' &&
        !student.studentProfile?.classEnrollments.some((item) => item.isActive && item.classModel.instructorId === (req as any).user.id)) {
      throw httpError(403, 'You can only log entries for students in your classes');
    }

    const approved = isAdminLevel((req as any).user.role) || type === 'CONVERSATION';
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.conductEntry.create({
        data: {
          studentId, authorId: (req as any).user.id, type, points, summary, followUp,
          status: approved ? 'APPROVED' : 'PENDING',
          reviewerId: isAdminLevel((req as any).user.role) ? (req as any).user.id : null,
          reviewedAt: isAdminLevel((req as any).user.role) ? new Date() : null
        },
        include: conductInclude
      });
      await tx.auditLog.create({
        data: {
          actorId: (req as any).user.id, actorRole: (req as any).user.role, action: 'CREATE',
          entityType: 'ConductEntry', entityId: created.id,
          description: `${type === 'INFRACTION' ? `${points}-point infraction` : 'Conversation note'} logged for ${student.name}`
        }
      });
      return created;
    });
    res.status(201).json(entry);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Unable to create conduct entry' });
  }
});

// Revisar entrada de conduta (Admin only)
router.patch('/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const status = (req as any).body.status;
    if (!['APPROVED', 'CLEARED'].includes(status)) {
      throw httpError(400, 'status must be APPROVED or CLEARED');
    }
    const existing = await prisma.conductEntry.findUnique({
      where: { id: (req as any).params.id },
      include: { student: true }
    });
    if (!existing) throw httpError(404, 'Entry not found');
    const points = existing.type === 'CONVERSATION' ? 0 : optionalInt((req as any).body.points, 'points', 1, 100, existing.points);

    const entry = await prisma.$transaction(async (tx) => {
      const updated = await tx.conductEntry.update({
        where: { id: existing.id },
        data: { status, points, reviewerId: (req as any).user.id, reviewedAt: new Date() },
        include: conductInclude
      });
      await tx.auditLog.create({
        data: {
          actorId: (req as any).user.id, actorRole: (req as any).user.role, action: status,
          entityType: 'ConductEntry', entityId: existing.id,
          description: `${status === 'CLEARED' ? 'Cleared' : 'Approved'} conduct entry for ${existing.student.name}${status === 'APPROVED' ? ` at ${points} points` : ''}`
        }
      });
      return updated;
    });
    res.json(entry);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Unable to review conduct entry' });
  }
});

export default router;
