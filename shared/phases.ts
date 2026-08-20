// Program phases, shared by the frontend (src/) and the backend (server/).
// Keep this file dependency-free so both build pipelines (Vite and esbuild)
// can import it.

/**
 * Year Up United runs a 12-month program: six months of Learning & Development
 * followed by six months of corporate internship.
 *
 * Phase 1 is instruction-based — weekly status reports go to the student's
 * Professional Skills Coach.
 * Phase 2 is the internship — weekly status reports and timesheets go to the
 * student's Placement Success Manager. Coaches stay in contact either way; only
 * the reporting line moves.
 */
export const PHASES = {
  PHASE_1: 'PHASE_1',
  PHASE_2: 'PHASE_2',
} as const;

export type ProgramPhase = (typeof PHASES)[keyof typeof PHASES];

/** Months of Learning & Development before the internship begins. */
export const PHASE_1_MONTHS = 6;

export const PHASE_LABELS: Record<ProgramPhase, string> = {
  PHASE_1: 'Phase 1 · Learning & Development',
  PHASE_2: 'Phase 2 · Corporate Internship',
};

export const PHASE_SHORT_LABELS: Record<ProgramPhase, string> = {
  PHASE_1: 'Phase 1',
  PHASE_2: 'Phase 2',
};

/**
 * Which phase a cohort is in on a given date.
 *
 * Returns PHASE_1 when the cohort start date is unknown. That is the safe
 * default: it preserves the existing behaviour of routing reports to the coach
 * rather than silently sending them to a PSM who may not be assigned.
 */
export function phaseForCohortStart(
  startDate?: Date | string | null,
  now: Date = new Date(),
): ProgramPhase {
  if (!startDate) return PHASES.PHASE_1;

  const start = startDate instanceof Date ? startDate : new Date(startDate);
  if (Number.isNaN(start.getTime())) return PHASES.PHASE_1;

  const monthsElapsed =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth()) -
    // Not a full month until the day-of-month has come around.
    (now.getUTCDate() < start.getUTCDate() ? 1 : 0);

  return monthsElapsed >= PHASE_1_MONTHS ? PHASES.PHASE_2 : PHASES.PHASE_1;
}

/** Phase 2 students submit timesheets; Phase 1 students do not. */
export function requiresTimesheet(phase: ProgramPhase): boolean {
  return phase === PHASES.PHASE_2;
}
