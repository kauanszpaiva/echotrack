import { ADMIN_LEVEL, COACH_LEVEL, STAFF_MANAGE, STUDENT_LEVEL, expandRoles } from '../../shared/roles';

/**
 * Which roles may open which area of the SPA.
 *
 * This is UX only — it stops a user landing on a page they cannot use and
 * hides areas from the sidebar. It is NOT a security control: every one of
 * these areas is backed by API endpoints that re-check the role server-side
 * (server/auth.ts → roleMiddleware). Changing this file cannot grant a user
 * any data they are not already authorised for.
 */
export const AREA_ROLES = {
  dev: ['DEV'],
  admin: ADMIN_LEVEL,
  /** Admin areas Program Managers share (users, reports, questions, analytics). */
  adminShared: STAFF_MANAGE,
  pm: ['PROGRAM_MANAGER'],
  coach: COACH_LEVEL,
  /** Placement. Coaching and placement are separate views of separate
      caseloads; one person can hold both jobs, so either role may open either
      area and each is scoped by assignment server-side. */
  psm: COACH_LEVEL,
  instructor: ['INSTRUCTOR'],
  student: STUDENT_LEVEL,
  /** Conduct log: admins plus the instructors who teach the student. */
  conduct: [...ADMIN_LEVEL, 'INSTRUCTOR'],
} as const;

export function canAccess(role: string | undefined | null, roles: readonly string[]): boolean {
  if (!role) return false;
  return expandRoles([...roles]).includes(role);
}

/** The landing route for a role. Used by /dashboard-redirect and by the guards. */
export function homePathForRole(role: string | undefined | null): string {
  switch (role) {
    case 'DEV':
    case 'ADMIN':
      return '/admin';
    case 'PROGRAM_MANAGER':
      return '/pm';
    case 'INSTRUCTOR':
      return '/instructor';
    case 'COACH':
      return '/coach';
    case 'PSM':
      return '/psm';
    case 'STUDENT':
    case 'INTERN':
      return '/student';
    // Placement and site staff have no dashboard of their own yet. Their profile
    // is the one page they can always reach; sending them to /login would bounce
    // an authenticated user in a loop.
    case 'CORPORATE_ENGAGEMENT_MANAGER':
    case 'INTERNSHIP_SERVICES_SPECIALIST':
    case 'SITE_OPERATIONS':
    case 'STUDENT_SERVICES':
    case 'DEVELOPMENT_FINANCE':
      return '/profile';
    // No role at all — not signed in, or an unrecognised value.
    default:
      return '/login';
  }
}
