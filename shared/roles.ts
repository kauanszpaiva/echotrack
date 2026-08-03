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
  COACH: 'Coach',
  PSM: 'PSM',
  STUDENT: 'Student',
  INTERN: 'Intern',
  INSTRUCTOR: 'Instructor',
};
