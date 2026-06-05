// Public surface of the pure core.

export type { PosReading, Vec3 } from './coords';
export { parseDistanceToken, parsePos, parsePosLine, parseSystemName } from './coords';
export type { BinarizeParams, PixelBuffer } from './image';
export { binarize, hashPixels, luminance } from './image';
export { clusterProb, DEFAULT_REL_TOL, matchOre, matchWithNoise } from './matcher';
export type { OcrCandidate } from './parse';
export { bestReading, parseReading } from './parse';
export type { QualityDetail } from './quality';
export { getQualityDetail } from './quality';
export type { ScanComposition, ScanResult } from './scan';
export { cleanMaterial, parseScanResult, snapMaterial } from './scan';
export type {
  AxisPlane,
  EntrySource,
  NewEntryInput,
  PlanarPoint,
  ScoutPresence,
  ScoutRole,
  SurveyEntry,
} from './survey';
export {
  dedupeEntries,
  distance,
  filterBySystem,
  isStablePos,
  makeEntry,
  mergeEntries,
  project,
} from './survey';
export type { SystemGroup } from './table';
export { groupLocations, loadSignatureTable } from './table';
export type {
  Clustering,
  ClusterParam,
  Deposit,
  DepositLocation,
  MatchContext,
  MatchOptions,
  OreCandidate,
  QualityMaterial,
  SignatureTable,
} from './types';
export type {
  PlausibilityOptions,
  VoteOptions,
  VoteResult,
  Voter,
  VoteState,
} from './validator';
export {
  createVoter,
  initialVoteState,
  isExpired,
  isPlausibleReading,
  voteStep,
} from './validator';
