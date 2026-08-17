// Router principal - agrega todos os sub-routers
import { Router } from 'express';
import { authMiddleware } from './auth.js';

// Sub-routers
import authRoutes from './routes/auth.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import roleRoutes from './routes/roles.js';
import conductRoutes from './routes/conduct.js';
import targetedQuestionRoutes from './routes/targeted-questions.js';
import engagementRoutes from './routes/engagement.js';
import cronRoutes from './routes/cron.js';

const router = Router();

// Auth routes (setup-account, signup)
router.use('/', authRoutes);

// Report routes (weekly reports, export)
router.use('/reports', reportRoutes);

// Admin routes
router.use('/admin', adminRoutes);

// Role-specific routes (student, coach, pm, instructor)
router.use('/', roleRoutes);

// Conduct routes
router.use('/conduct', conductRoutes);

// Targeted questions routes
router.use('/targeted-questions', targetedQuestionRoutes);

// Student engagement domain (check-ins, goals, templates, annotations)
router.use('/', engagementRoutes);

// Scheduled jobs — authenticated by CRON_SECRET, not by a user session.
router.use('/cron', cronRoutes);

// Session route
router.get('/auth/session', authMiddleware, async (req, res) => {
  const { default: prisma } = await import('./prisma.js');
  const user = await prisma.user.findUnique({
    where: { id: (req as any).user.id },
    select: { id: true, email: true, name: true, role: true }
  });
  if (!user) return res.status(401).json({ error: 'Invalid' });
  res.json({ user });
});

// Dashboard redirect
router.get('/dashboard-redirect', authMiddleware, (req, res) => {
  const role = (req as any).user.role;
  switch (role) {
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

export default router;
