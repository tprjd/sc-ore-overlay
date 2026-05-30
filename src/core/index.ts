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

export { binarize, hashPixels, luminance } from './image';
export type { PixelBuffer, BinarizeParams } from './image';

export { parseReading, bestReading } from './parse';
export type { OcrCandidate } from './parse';
