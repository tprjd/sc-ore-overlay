// Public surface of the pure core.

export type {
  ClusterParam,
  Clustering,
  DepositLocation,
  Deposit,
  SignatureTable,
  MatchOptions,
  MatchContext,
  OreCandidate,
} from './types';

export { matchOre, clusterProb, DEFAULT_REL_TOL } from './matcher';

export {
  isPlausibleReading,
  voteStep,
  createVoter,
  initialVoteState,
} from './validator';
export type {
  PlausibilityOptions,
  VoteOptions,
  VoteState,
  VoteResult,
  Voter,
} from './validator';

export { loadSignatureTable, groupLocations } from './table';
export type { SystemGroup } from './table';
