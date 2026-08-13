// Rotas de perguntas direcionadas (targeted questions)
import { Router } from 'express';
import prisma from '../prisma.js';
import { authMiddleware, roleMiddleware } from '../auth.js';
import { isAdminLevel, isCoachLevel, isStudentLevel, STUDENT_LEVEL } from '../../shared/roles.js';
import { targetedQuestionSchema } from '../schemas.js';
import { requiredString, httpError } from './helpers.js';

const router = Router();

// Buscar perguntas direcionadas (scoped por role)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const where: any = { isActive: true };
    if (isStudentLevel(req.user.role)) {
      where.studentId = req.user.id;
    } else if (req.user.role === 'PROGRAM_MANAGER') {
      const students = await prisma.user.findMany({
        where: { role: { in: STUDENT_LEVEL }, studentProfile: { programManagerId: req.user.id } },
        select: { id: true }
      });
      where.studentId = { in: students.map((s) => s.id) };
    } else if (isCoachLevel(req.user.role)) {
      const students = await prisma.user.findMany({
        where: { role: { in: STUDENT_LEVEL }, studentProfile: { coachId: req.user.id } },
        select: { id: true }
      });
      where.studentId = { in: students.map((s) => s.id) };
    } else if (!isAdminLevel(req.user.role)) {
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

// Criar pergunta direcionada
router.post('/', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
  const parsed = targetedQuestionSchema.safeParse(req.body);
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

    if (req.user.role === 'PROGRAM_MANAGER') {
      if (student?.studentProfile?.programManagerId !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized to target this student' });
      }
    }

    const created = await prisma.targetedQuestion.create({
      data: { question, studentId, cycleId: cycleId || null, creatorId: req.user.id }
    });
    res.json(created);
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

// Deletar pergunta direcionada (soft delete)
router.delete('/', authMiddleware, roleMiddleware(['ADMIN', 'PROGRAM_MANAGER']), async (req, res) => {
  try {
    const { id } = req.query;
    const q = await prisma.targetedQuestion.findUnique({ where: { id: String(id) } });
    if (!q) return res.status(404).json({ error: 'Not found' });

    if (req.user.role === 'PROGRAM_MANAGER' && q.creatorId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to delete this question' });
    }

    await prisma.targetedQuestion.update({ where: { id: String(id) }, data: { isActive: false } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
