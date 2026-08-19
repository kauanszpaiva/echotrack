// Rotas de autenticação: setup de conta e signup
import { Router } from 'express';
import prisma from '../prisma.js';
import { provisionClerkUser, deleteClerkUser } from '../clerkAdmin.js';
import { isCoachLevel } from '../../shared/roles.js';
import { newInvite, omitSensitive } from './helpers.js';
import { setupAccountSchema, signupSchema } from '../schemas.js';

const router = Router();

// Setup de conta via invite token
router.post('/setup-account', async (req, res) => {
  const parsed = setupAccountSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { token, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { inviteToken: token } });
    if (!user || user.accountStatus !== 'INVITED') {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    if (user.inviteExpires && user.inviteExpires.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const clerkUser = await provisionClerkUser({
      email: user.email, password, name: user.name, role: user.role,
    });

    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          clerkUserId: clerkUser.id,
          inviteToken: null,
          inviteExpires: null,
          accountStatus: 'ACTIVE',
        }
      });
    } catch (dbError) {
      if (clerkUser.created) await deleteClerkUser(clerkUser.id);
      throw dbError;
    }

    await prisma.auditLog.create({
      data: { actorId: updatedUser.id, actorRole: updatedUser.role, action: 'ACTIVATE', entityType: 'User', entityId: updatedUser.id, description: `User setup account via token` }
    });

    res.json({
      success: true,
      user: { id: updatedUser.id, email: updatedUser.email, name: updatedUser.name, role: updatedUser.role }
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
  }
});

// Signup de estudante
router.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse((req as any).body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { name, email, password, programManagerId, coachId, pathwayId, classIds } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(400).json({ error: 'Email already in use' });

    const [pm, coach, pathway, classes] = await Promise.all([
      prisma.user.findUnique({ where: { id: programManagerId } }),
      prisma.user.findUnique({ where: { id: coachId } }),
      prisma.pathway.findUnique({ where: { id: pathwayId } }),
      prisma.classModel.findMany({ where: { id: { in: classIds } } })
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
    if (classes.length !== classIds.length || classes.some((cls) => !cls.isActive || cls.pathwayId !== pathway.id)) {
      return res.status(400).json({ error: 'Invalid class selection' });
    }

    const clerkUser = await provisionClerkUser({
      email: normalizedEmail, password, name, role: 'STUDENT',
    });

    let student;
    try {
      student = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: clerkUser.id,
            clerkUserId: clerkUser.id,
            name, email: normalizedEmail,
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
          data: classIds.map(cid => ({ classId: cid, studentProfileId: profile.id }))
        });
        return user;
      });
    } catch (dbError) {
      if (clerkUser.created) await deleteClerkUser(clerkUser.id);
      throw dbError;
    }

    res.json({
      success: true,
      user: { id: student.id, email: student.email, name: student.name, role: student.role }
    });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error during signup' });
  }
});

export default router;
