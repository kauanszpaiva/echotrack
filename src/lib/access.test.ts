import { describe, expect, it } from 'vitest';
import { AREA_ROLES, canAccess, homePathForRole } from './access';
import { ALL_ROLES } from '../../shared/roles';

/**
 * Front-end route guards. This is UX, not security — the matching server-side
 * checks live in server/__tests__/auth.test.ts — but a Student must not be able
 * to open /admin just by typing the URL.
 */
describe('SPA area access', () => {
  it('keeps students and interns out of every staff area', () => {
    for (const role of ['STUDENT', 'INTERN']) {
      expect(canAccess(role, AREA_ROLES.admin)).toBe(false);
      expect(canAccess(role, AREA_ROLES.adminShared)).toBe(false);
      expect(canAccess(role, AREA_ROLES.pm)).toBe(false);
      expect(canAccess(role, AREA_ROLES.coach)).toBe(false);
      expect(canAccess(role, AREA_ROLES.instructor)).toBe(false);
      expect(canAccess(role, AREA_ROLES.dev)).toBe(false);
      expect(canAccess(role, AREA_ROLES.student)).toBe(true);
    }
  });

  it('keeps coaches and PSMs out of admin and PM areas', () => {
    for (const role of ['COACH', 'PSM']) {
      expect(canAccess(role, AREA_ROLES.admin)).toBe(false);
      expect(canAccess(role, AREA_ROLES.adminShared)).toBe(false);
      expect(canAccess(role, AREA_ROLES.pm)).toBe(false);
      expect(canAccess(role, AREA_ROLES.coach)).toBe(true);
    }
  });

  it('keeps instructors inside their own scope plus the conduct log', () => {
    expect(canAccess('INSTRUCTOR', AREA_ROLES.admin)).toBe(false);
    expect(canAccess('INSTRUCTOR', AREA_ROLES.coach)).toBe(false);
    expect(canAccess('INSTRUCTOR', AREA_ROLES.student)).toBe(false);
    expect(canAccess('INSTRUCTOR', AREA_ROLES.instructor)).toBe(true);
    expect(canAccess('INSTRUCTOR', AREA_ROLES.conduct)).toBe(true);
  });

  it('gives Program Managers the shared admin screens but not admin-only ones', () => {
    expect(canAccess('PROGRAM_MANAGER', AREA_ROLES.adminShared)).toBe(true);
    expect(canAccess('PROGRAM_MANAGER', AREA_ROLES.admin)).toBe(false);
    expect(canAccess('PROGRAM_MANAGER', AREA_ROLES.dev)).toBe(false);
    expect(canAccess('PROGRAM_MANAGER', AREA_ROLES.pm)).toBe(true);
  });

  it('mirrors ADMIN access to DEV, and reserves the dev panel for DEV', () => {
    expect(canAccess('DEV', AREA_ROLES.admin)).toBe(true);
    expect(canAccess('DEV', AREA_ROLES.dev)).toBe(true);
    expect(canAccess('ADMIN', AREA_ROLES.dev)).toBe(false);
    expect(canAccess('ADMIN', AREA_ROLES.pm)).toBe(false);
  });

  it('denies access when the role is missing or unknown', () => {
    for (const area of Object.values(AREA_ROLES)) {
      expect(canAccess(undefined, area)).toBe(false);
      expect(canAccess(null, area)).toBe(false);
      expect(canAccess('SUPERADMIN', area)).toBe(false);
    }
  });

  it('routes every known role to a real dashboard', () => {
    for (const role of ALL_ROLES) {
      expect(homePathForRole(role)).not.toBe('/login');
    }
    expect(homePathForRole(undefined)).toBe('/login');
  });
});
