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
