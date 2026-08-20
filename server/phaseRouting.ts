import prisma from './prisma.js';
import { isAdminLevel } from '../shared/roles.js';
import { PHASES, phaseForCohortStart, type ProgramPhase } from '../shared/phases.js';

/**
 * Where a student's weekly status report goes.
 *
 * Phase 1 (Learning & Development) is instruction-based, so reports go to the
 * Professional Skills Coach. Phase 2 (Corporate Internship) routes reports and
 * timesheets to the Placement Success Manager, who owns the employer
 * relationship and tracks attendance and timesheet compliance.
 *
 * The phase comes from the cohort start date via the student's learning
 * community. When that is unknown the student is treated as Phase 1, which
 * keeps reports going to the coach rather than to a PSM who may not be assigned.
 */
export interface ReportRouting {
  phase: ProgramPhase;
  recipientId: string | null;
  recipientRole: 'COACH' | 'PSM' | null;
  /** True when the phase calls for a PSM but none is assigned to the student. */
  missingRecipient: boolean;
}

/** The student profile shape this module needs. */
const ROUTING_INCLUDE = {
  coach: { select: { id: true, name: true, email: true } },
  psm: { select: { id: true, name: true, email: true } },
  community: { select: { id: true, name: true, cohort: { select: { id: true, name: true, startDate: true } } } },
} as const;

export async function loadRoutingProfile(userId: string) {
  return prisma.studentProfile.findUnique({
    where: { userId },
    include: ROUTING_INCLUDE,
  });
}

export function routingFor(profile: any, now: Date = new Date()): ReportRouting {
  const phase = phaseForCohortStart(profile?.community?.cohort?.startDate, now);

  if (phase === PHASES.PHASE_2) {
    const psmId = profile?.psmId ?? null;
    if (psmId) return { phase, recipientId: psmId, recipientRole: 'PSM', missingRecipient: false };

    // No PSM assigned yet — fall back to the coach so the report is never
    // orphaned, and flag it so the UI can tell the student who to chase.
    return {
      phase,
      recipientId: profile?.coachId ?? null,
      recipientRole: profile?.coachId ? 'COACH' : null,
      missingRecipient: true,
    };
  }

  return {
    phase,
    recipientId: profile?.coachId ?? null,
    recipientRole: profile?.coachId ? 'COACH' : null,
    missingRecipient: !profile?.coachId,
  };
}

/**
 * Whether a staff member may read a student's reports and timesheets.
 *
 * Access follows the assignment, not the role label. One person can coach some
 * students and be the PSM for others — `User.role` holds only one value, so
 * gating on it would lock a dual-hatted PSM out of their own caseload. Checking
 * the assignment is both more permissive where it should be and stricter
 * everywhere else: being a coach grants nothing for students you do not coach.
 */
export function servesStudent(
  reqUser: { id: string; role: string },
  profile: { coachId?: string | null; psmId?: string | null; programManagerId?: string | null } | null,
): boolean {
  if (!profile) return false;
  if (isAdminLevel(reqUser.role)) return true;
  return (
    profile.coachId === reqUser.id ||
    profile.psmId === reqUser.id ||
    profile.programManagerId === reqUser.id
  );
}
