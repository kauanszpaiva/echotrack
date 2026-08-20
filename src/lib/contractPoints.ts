// The contract rules moved to shared/ so the server can apply the same maths.
// Re-exported here so existing imports keep working.
export type { ContractTrack, ContractTrackRules, ContractStanding, StandingLevel } from '../../shared/contract';
export {
  CONTRACT_TRACK_RULES,
  CONTRACT_TRACKS,
  calculateContractPoints,
  contractStanding,
  isContractTrack,
} from '../../shared/contract';
