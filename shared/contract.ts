// Performance Contract rules and standing, shared by the frontend (src/) and the
// backend (server/). Keep this file dependency-free so both build pipelines
// (Vite and esbuild) can import it.

export type ContractTrack = 'IT' | 'BUSINESS' | 'CUSTOMER_EXPERIENCE';

export interface ContractTrackRules {
  label: string;
  basePoints: number;
  durationWeeks: number;
  pointsPerWeek: number;
}

export const CONTRACT_TRACK_RULES: Record<ContractTrack, ContractTrackRules> = {
  IT: { label: 'IT', basePoints: 200, durationWeeks: 21, pointsPerWeek: 10 },
  BUSINESS: { label: 'Business', basePoints: 200, durationWeeks: 21, pointsPerWeek: 10 },
  CUSTOMER_EXPERIENCE: {
    label: 'Customer Experience (CX)',
    basePoints: 150,
    durationWeeks: 12,
    pointsPerWeek: 10,
  },
};

export const CONTRACT_TRACKS = Object.keys(CONTRACT_TRACK_RULES) as ContractTrack[];

export function isContractTrack(value: unknown): value is ContractTrack {
  return typeof value === 'string' && value in CONTRACT_TRACK_RULES;
}

/** What a track's contract is worth in total, before any deductions. */
export function calculateContractPoints(track: ContractTrack, weeksMet: number) {
  const rules = CONTRACT_TRACK_RULES[track];

  if (!Number.isInteger(weeksMet) || weeksMet < 0 || weeksMet > rules.durationWeeks) {
    throw new RangeError(`Weeks met must be a whole number from 0 to ${rules.durationWeeks}.`);
  }

  const earnedPoints = weeksMet * rules.pointsPerWeek;

  return {
    ...rules,
    weeksMet,
    earnedPoints,
    totalPoints: rules.basePoints + earnedPoints,
    maximumPoints: rules.basePoints + rules.durationWeeks * rules.pointsPerWeek,
  };
}

/* ────────────────────────────── standing ────────────────────────────── */

export const CONTRACT_STATUSES = {
  ACTIVE: 'ACTIVE',
  EPIC: 'EPIC',
  DISMISSED: 'DISMISSED',
  COMPLETED: 'COMPLETED',
} as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[keyof typeof CONTRACT_STATUSES];

/** How a student's point balance reads against the program's thresholds. */
export type StandingLevel = 'GOOD' | 'STIPEND_AT_RISK' | 'EPIC_RISK';

export interface ContractStanding {
  track: ContractTrack;
  trackLabel: string;
  /** Points the contract opens with (200 on most tracks, 150 on CX). */
  basePoints: number;
  weeksMet: number;
  /** Points earned for weeks that met expectations. */
  earnedPoints: number;
  /** Points available before deductions: base + earned. */
  availablePoints: number;
  /** Total deducted by approved infractions. */
  deductedPoints: number;
  /** What the student actually stands at. Never below zero. */
  balance: number;
  maximumPoints: number;
  stipendThreshold: number;
  epicThreshold: number;
  stipendEligible: boolean;
  /** True once the balance sits at or below the EPIC threshold. */
  epicRecommended: boolean;
  level: StandingLevel;
}

export interface StandingThresholds {
  stipendThreshold: number;
  epicThreshold: number;
}

/**
 * A student's standing under their Performance Contract.
 *
 * Points work like a professional standing "bank account": the contract opens
 * with a pool, weeks that meet expectations add to it, and approved infractions
 * (unexcused absences, lateness, missed submissions, unprofessional conduct)
 * deduct from it. The balance drives stipend eligibility and Phase 2 internship
 * matching; falling to the EPIC threshold flags the student for a Performance
 * Improvement plan.
 *
 * `deductedPoints` should be the sum of APPROVED infraction points only —
 * pending entries have not been upheld yet, and cleared ones were reversed.
 */
export function contractStanding(
  track: ContractTrack,
  weeksMet: number,
  deductedPoints: number,
  thresholds: StandingThresholds,
): ContractStanding {
  const points = calculateContractPoints(track, weeksMet);
  const deducted = Math.max(0, Math.round(deductedPoints));
  const balance = Math.max(0, points.totalPoints - deducted);

  const stipendEligible = balance >= thresholds.stipendThreshold;
  const epicRecommended = balance <= thresholds.epicThreshold;

  return {
    track,
    trackLabel: points.label,
    basePoints: points.basePoints,
    weeksMet: points.weeksMet,
    earnedPoints: points.earnedPoints,
    availablePoints: points.totalPoints,
    deductedPoints: deducted,
    balance,
    maximumPoints: points.maximumPoints,
    stipendThreshold: thresholds.stipendThreshold,
    epicThreshold: thresholds.epicThreshold,
    stipendEligible,
    epicRecommended,
    // EPIC risk is the more serious signal, so it wins when both apply.
    level: epicRecommended ? 'EPIC_RISK' : stipendEligible ? 'GOOD' : 'STIPEND_AT_RISK',
  };
}
