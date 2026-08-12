// Single source of truth for user roles, shared by the frontend (src/) and the
// backend (server/). Keep this file dependency-free so both build pipelines
// (Vite and esbuild) can import it.

export const ROLES = {
  DEV: 'DEV',
  ADMIN: 'ADMIN',
  PROGRAM_MANAGER: 'PROGRAM_MANAGER',
  COACH: 'COACH',
  PSM: 'PSM',
  STUDENT: 'STUDENT',
  INTERN: 'INTERN',
  INSTRUCTOR: 'INSTRUCTOR',

  // Placement-side and site staff. These carry NO permissions of their own —
  // they are deliberately absent from every permission group below, so an
  // account with one of these roles can reach its own profile and the member
  // directory and nothing else. Grant them access explicitly when needed.
  CORPORATE_ENGAGEMENT_MANAGER: 'CORPORATE_ENGAGEMENT_MANAGER',
  INTERNSHIP_SERVICES_SPECIALIST: 'INTERNSHIP_SERVICES_SPECIALIST',
  SITE_OPERATIONS: 'SITE_OPERATIONS',
  STUDENT_SERVICES: 'STUDENT_SERVICES',
  DEVELOPMENT_FINANCE: 'DEVELOPMENT_FINANCE',
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: UserRole[] = Object.values(ROLES);

// ── Permission groups ───────────────────────────────────────────────────────
// DEV mirrors ADMIN, PSM mirrors COACH, INTERN mirrors STUDENT.
export const ADMIN_LEVEL: UserRole[] = ['ADMIN', 'DEV'];
export const COACH_LEVEL: UserRole[] = ['COACH', 'PSM'];
export const STUDENT_LEVEL: UserRole[] = ['STUDENT', 'INTERN'];
export const STAFF_MANAGE: UserRole[] = ['ADMIN', 'DEV', 'PROGRAM_MANAGER'];

export function isAdminLevel(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'DEV';
}
export function isCoachLevel(role?: string | null): boolean {
  return role === 'COACH' || role === 'PSM';
}
export function isStudentLevel(role?: string | null): boolean {
  return role === 'STUDENT' || role === 'INTERN';
}

/**
 * Expand a required-roles list so equivalent roles clear the same gate:
 * ADMIN ⇒ DEV, COACH ⇒ PSM, STUDENT ⇒ INTERN. Used by roleMiddleware so we
 * don't have to touch every call site to grant the new roles their access.
 */
export function expandRoles(roles: string[]): string[] {
  const set = new Set(roles);
  if (set.has('ADMIN')) set.add('DEV');
  if (set.has('COACH')) set.add('PSM');
  if (set.has('STUDENT')) set.add('INTERN');
  return [...set];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  DEV: 'Dev',
  ADMIN: 'Admin',
  PROGRAM_MANAGER: 'Program Manager',
  COACH: 'Professional Skills Coach',
  PSM: 'Placement Success Manager',
  STUDENT: 'Student',
  INTERN: 'Intern',
  INSTRUCTOR: 'Instructor',
  CORPORATE_ENGAGEMENT_MANAGER: 'Corporate Engagement Manager',
  INTERNSHIP_SERVICES_SPECIALIST: 'Internship Services Specialist',
  SITE_OPERATIONS: 'Site Operations & Admin',
  STUDENT_SERVICES: 'Student Services',
  DEVELOPMENT_FINANCE: 'Grants, Development & Finance',
};

/**
 * How staff roles group into the four operating functions of a site. Used to
 * organise the member directory; it carries no authority of its own.
 *
 * PSM sits under placement because that is the job — but note it is still in
 * COACH_LEVEL above, so PSMs retain coach-level access to their students. That
 * pairing is intentional until someone confirms PSMs should lose it.
 */
export const STAFF_FUNCTIONS: { key: string; label: string; description: string; roles: UserRole[] }[] = [
  {
    key: 'PLACEMENT',
    label: 'Corporate Engagement & Placement',
    description: 'Employer partnerships, internship matching, and post-graduation placement',
    roles: ['CORPORATE_ENGAGEMENT_MANAGER', 'PSM', 'INTERNSHIP_SERVICES_SPECIALIST'],
  },
  {
    key: 'PROGRAM',
    label: 'Learning Community & Program Leadership',
    description: 'Program managers and the coaches mentoring students in this learning community',
    roles: ['PROGRAM_MANAGER', 'COACH'],
  },
  {
    key: 'ACADEMIC',
    label: 'Academic & Instructional Staff',
    description: 'Track and business communications instructors',
    roles: ['INSTRUCTOR'],
  },
  {
    key: 'OPERATIONS',
    label: 'Operations & Organizational Support',
    description: 'Site operations, student services, and development & finance',
    roles: ['SITE_OPERATIONS', 'STUDENT_SERVICES', 'DEVELOPMENT_FINANCE'],
  },
];

/** Every role that belongs to a staff function (i.e. everyone in the directory's staff groups). */
export const STAFF_FUNCTION_ROLES: UserRole[] = STAFF_FUNCTIONS.flatMap((fn) => fn.roles);

export function staffFunctionForRole(role?: string | null): string | null {
  return STAFF_FUNCTIONS.find((fn) => fn.roles.includes(role as UserRole))?.key ?? null;
}
