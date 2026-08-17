// Resource-scope authorization.
//
// `roleMiddleware` answers "may this role reach this route at all". It cannot
// answer "may this user reach *this record*" — that is what this module is for.
// Without it, a coach reaches any student's data by editing an id in the URL,
// which is exactly the hole the migration brief calls out.
//
// Two rules govern everything here:
//
//   1. Deny by default. Every helper returns false unless a concrete row proves
//      the relationship. No `catch` swallows a failed lookup into an allow.
//   2. Never trust a claim. Role arrives from the verified Clerk session via
//      `authMiddleware`; ids arrive from the URL. A role alone never grants
//      access to a scoped record — a membership/assignment row must exist.

import prisma from '../prisma.js';
import { isAdminLevel } from '../../shared/roles.js';
import { httpError } from '../routes/helpers.js';

export interface ScopeActor {
  id: string;
  role: string;
}

export interface StudentScopeOptions {
  /**
   * Whether a PSM may reach this student through their placement assignment.
   *
   * `expandRoles` lets PSM clear any `COACH` route gate, so without this flag a
   * PSM would inherit the whole coaching surface just by holding the role — the
   * isolation the brief forbids. Confidential academic/coaching resources leave
   * this false; placement resources opt in explicitly.
   */
  allowPsm?: boolean;
  /** Whether an instructor may reach the student via a shared class. */
  allowInstructor?: boolean;
}

/**
 * A cross-scope miss is reported as 404, not 403.
 *
 * 403 confirms the record exists, which is itself a disclosure when ids are
 * being probed. 404 makes "not yours" and "not there" indistinguishable.
 */
export function notFound(resource = 'Resource'): Error & { status: number } {
  return httpError(404, `${resource} not found`);
}

// ── Individual relationship checks ─────────────────────────────────────────

/** The student's own record. */
export function isSelf(actor: ScopeActor, studentId: string): boolean {
  return actor.id === studentId;
}

/** A coaching assignment recorded on the student's profile. */
export async function isAssignedCoach(coachId: string, studentId: string): Promise<boolean> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentId },
    select: { coachId: true },
  });
  return Boolean(profile && profile.coachId === coachId);
}

/** A program-manager assignment, either direct or via the student's community. */
export async function isAssignedProgramManager(pmId: string, studentId: string): Promise<boolean> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentId },
    select: { programManagerId: true, communityId: true },
  });
  if (!profile) return false;
  if (profile.programManagerId === pmId) return true;
  if (!profile.communityId) return false;

  const community = await prisma.community.findUnique({
    where: { id: profile.communityId },
    select: { programManagerId: true },
  });
  return Boolean(community && community.programManagerId === pmId);
}

/**
 * An active staff membership on the class.
 *
 * `classModel.instructorId` is honoured as a legacy fallback so classes created
 * before `ClassStaffMembership` existed do not lose their instructor. It is a
 * real ownership record, not a role claim.
 */
export async function hasClassStaffAccess(userId: string, classId: string): Promise<boolean> {
  const membership = await prisma.classStaffMembership.findFirst({
    where: { userId, classId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (membership) return true;

  const classModel = await prisma.classModel.findUnique({
    where: { id: classId },
    select: { instructorId: true },
  });
  return Boolean(classModel && classModel.instructorId === userId);
}

/** The student is actively enrolled in the class. */
export async function isEnrolledInClass(studentId: string, classId: string): Promise<boolean> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentId },
    select: { id: true },
  });
  if (!profile) return false;

  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentProfileId: profile.id, classId, isActive: true },
    select: { id: true },
  });
  return Boolean(enrollment);
}

/** The actor teaches a class the student is enrolled in. */
export async function sharesClassWithStudent(staffId: string, studentId: string): Promise<boolean> {
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: studentId },
    select: { id: true },
  });
  if (!profile) return false;

  const enrollments = await prisma.studentClassEnrollment.findMany({
    where: { studentProfileId: profile.id, isActive: true },
    select: { classId: true },
  });
  if (enrollments.length === 0) return false;

  const classIds = enrollments.map((e) => e.classId);

  const membership = await prisma.classStaffMembership.findFirst({
    where: { userId: staffId, classId: { in: classIds }, status: 'ACTIVE' },
    select: { id: true },
  });
  if (membership) return true;

  const legacy = await prisma.classModel.findFirst({
    where: { id: { in: classIds }, instructorId: staffId },
    select: { id: true },
  });
  return Boolean(legacy);
}

// ── Composite decisions ────────────────────────────────────────────────────

/**
 * May `actor` read/write a resource belonging to `studentId`?
 *
 * PSM is deliberately handled apart from COACH: `expandRoles` merges them at the
 * route gate, so this is the only layer where the distinction can still be made.
 */
export async function canAccessStudent(
  actor: ScopeActor,
  studentId: string,
  options: StudentScopeOptions = {},
): Promise<boolean> {
  if (!actor?.id || !studentId) return false;
  if (isAdminLevel(actor.role)) return true;
  if (isSelf(actor, studentId)) return true;

  switch (actor.role) {
    case 'COACH':
      return isAssignedCoach(actor.id, studentId);

    case 'PSM':
      // Placement scope only, and still only for an assigned student.
      if (!options.allowPsm) return false;
      return (await isAssignedCoach(actor.id, studentId)) || isAssignedProgramManager(actor.id, studentId);

    case 'PROGRAM_MANAGER':
      return isAssignedProgramManager(actor.id, studentId);

    case 'INSTRUCTOR':
      if (!options.allowInstructor) return false;
      return sharesClassWithStudent(actor.id, studentId);

    default:
      // STUDENT / INTERN reach only their own records, already handled by isSelf.
      return false;
  }
}

/** Throwing form of `canAccessStudent`. Raises 404 rather than 403. */
export async function assertStudentScope(
  actor: ScopeActor,
  studentId: string,
  options: StudentScopeOptions = {},
): Promise<void> {
  if (!(await canAccessStudent(actor, studentId, options))) {
    throw notFound('Student');
  }
}

/** May `actor` act on this class? Admin by policy, everyone else by membership. */
export async function canAccessClass(actor: ScopeActor, classId: string): Promise<boolean> {
  if (!actor?.id || !classId) return false;
  if (isAdminLevel(actor.role)) return true;
  if (actor.role === 'PROGRAM_MANAGER') return true;
  if (actor.role === 'STUDENT' || actor.role === 'INTERN') {
    return isEnrolledInClass(actor.id, classId);
  }
  return hasClassStaffAccess(actor.id, classId);
}

/** Throwing form of `canAccessClass`. */
export async function assertClassScope(actor: ScopeActor, classId: string): Promise<void> {
  if (!(await canAccessClass(actor, classId))) {
    throw notFound('Class');
  }
}

/** May `actor` read this chat channel? Membership row required — no role bypass. */
export async function isChannelMember(userId: string, channelId: string): Promise<boolean> {
  const member = await prisma.chatChannelMember.findFirst({
    where: { channelId, userId },
    select: { id: true },
  });
  return Boolean(member);
}

/**
 * Throwing form of `isChannelMember`.
 *
 * Admins are NOT exempt: a private channel's contents are not an administrative
 * resource, and joining is auditable in a way a silent read is not.
 */
export async function assertChannelMembership(actor: ScopeActor, channelId: string): Promise<void> {
  if (!(await isChannelMember(actor.id, channelId))) {
    throw notFound('Channel');
  }
}
