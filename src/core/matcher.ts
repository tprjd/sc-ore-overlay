// The matcher — the crown jewel. Pure function, fully unit-tested.
//
// Given a validated integer RS reading, return every ore that could plausibly
// have produced it, ranked by score. Identification is constrained division:
// a deposit qualifies only when its signature divides the reading cleanly AND
// the resulting node count falls inside that deposit's valid cluster range.

import type {
  Clustering,
  Deposit,
  MatchContext,
  MatchOptions,
  OreCandidate,
  SignatureTable,
} from './types';

// Adjacent ores' signatures differ by only ~15 (≈0.35%), and RS = signature ×
// nodes is an exact integer, so the true ore divides with ~zero error while a
// neighbour sits ~0.35% off. Keep the tolerance below that, with a little slack,
// to avoid false neighbour matches. (PP-OCR reads exact digits — no analog
// jitter to absorb.)
/** Default relative tolerance: the reading must divide to within 0.2%. */
export const DEFAULT_REL_TOL = 0.002;

/**
 * Probability weight in (0, 1] that a deposit produces exactly `nodes` rocks.
 *
 * Buckets are treated as weights for the event "node count lands in this
 * bucket". The weight of the bucket(s) containing `nodes` is normalized by the
 * total weight across all buckets, so the result is comparable across deposits
 * regardless of how the wiki scaled the raw `relative_probability` values.
 *
 * - Empty `params` → uniform over the valid range.
 * - `nodes` inside the overall range but in no bucket → a tiny positive epsilon
 *   (still a valid size, just unweighted), so the candidate survives but ranks
 *   below any weighted match.
 */
export function clusterProb(clustering: Clustering, nodes: number): number {
  const { params, minSize, maxSize } = clustering;
  if (!params || params.length === 0) {
    const span = Math.max(1, maxSize - minSize + 1);
    return 1 / span;
  }
  let total = 0;
  let matched = 0;
  for (const p of params) {
    total += p.relativeProbability;
    if (nodes >= p.minSize && nodes <= p.maxSize) matched += p.relativeProbability;
  }
  if (total <= 0) return Number.EPSILON;
  if (matched <= 0) return Number.EPSILON;
  return matched / total;
}

/**
 * Identify the ore(s) behind a reading.
 *
 * Implements the CLAUDE.md spec exactly:
 *
 *   for each deposit:
 *     skip if method not supported
 *     skip if a location context is set and the deposit doesn't spawn there
 *     n = round(reading / signature); skip if n < 1
 *     relErr = |reading - n*signature| / reading; skip if relErr > relTol
 *     skip if n outside [minSize, maxSize]
 *     score = (1 - relErr) * clusterProb(deposit, n) * (locationProb or 1)
 *   merge by ore name (keep best score), sort by score desc, return ALL.
 *
 * Returns every qualifying ore (never silently picks one) so overlapping
 * signatures surface as multiple candidates.
 */
export function matchOre(
  reading: number,
  table: SignatureTable | Deposit[],
  opts: MatchOptions,
  context: MatchContext = {},
): OreCandidate[] {
  const deposits = Array.isArray(table) ? table : table.deposits;
  const relTol = opts.relTol ?? DEFAULT_REL_TOL;
  const { method } = opts;
  const location = context.location ?? null;

  // A reading must be a positive integer to identify anything.
  if (!Number.isFinite(reading) || !Number.isInteger(reading) || reading < 1) {
    return [];
  }

  // Keep the best candidate per ore name (overlap across deposits of the same
  // ore collapses; overlap across *different* ores stays as separate entries).
  const byName = new Map<string, OreCandidate>();

  for (const deposit of deposits) {
    if (!deposit.methods.includes(method)) continue;

    let locationProb = 1;
    if (location != null) {
      const hit = deposit.locations.find((l) => l.name === location);
      if (!hit) continue;
      locationProb = hit.probability ?? 1;
    }

    if (deposit.signature <= 0) continue;

    const n = Math.round(reading / deposit.signature);
    if (n < 1) continue;

    const relErr = Math.abs(reading - n * deposit.signature) / reading;
    if (relErr > relTol) continue;

    if (n < deposit.clustering.minSize || n > deposit.clustering.maxSize) continue;

    const score = (1 - relErr) * clusterProb(deposit.clustering, n) * locationProb;
    const candidate: OreCandidate = {
      name: deposit.name,
      nodes: n,
      score,
      signature: deposit.signature,
    };

    const prev = byName.get(deposit.name);
    if (!prev || candidate.score > prev.score) byName.set(deposit.name, candidate);
  }

  return [...byName.values()].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
}

/**
 * Direct matches outrank noise-subtracted matches; the wreck/sat hypothesis is
 * the *less* parsimonious explanation, so we penalize it. 0.7 keeps noise hits
 * visible behind a clean match but ahead of "no match" silence.
 */
const NOISE_SCORE_PENALTY = 0.7;

/**
 * Identify the ore(s) behind a reading, optionally after subtracting one of a
 * list of known non-ore "noise" signatures (wrecks, satellites, debris panels).
 *
 * Star Citizen's scanner sometimes lumps a wreck signal into the same RS chip
 * as the ore — e.g. a ~10,000-unit wreck on top of `4270 × 3 = 12,810` reads as
 * `22,810`. matchOre alone fails on that reading. This helper tries the raw
 * reading first, then `reading - noise` for each noise in `noises`, and labels
 * the resulting candidates with the noise value that produced them.
 *
 * Direct (noise == null) matches are returned ahead of noise hits at equal
 * score; noise hits are penalized so they only surface when there is no clean
 * match.
 */
export function matchWithNoise(
  reading: number,
  table: SignatureTable | Deposit[],
  opts: MatchOptions,
  context: MatchContext = {},
  noises: readonly number[] = [],
): OreCandidate[] {
  const direct = matchOre(reading, table, opts, context).map((c) => ({ ...c, noise: null }));

  const seen = new Set<string>(direct.map((c) => `${c.name}|${c.nodes}|n`));
  const noiseHits: OreCandidate[] = [];
  for (const noise of noises) {
    if (!Number.isInteger(noise) || noise <= 0 || noise >= reading) continue;
    for (const c of matchOre(reading - noise, table, opts, context)) {
      const key = `${c.name}|${c.nodes}|${noise}`;
      if (seen.has(key)) continue;
      seen.add(key);
      noiseHits.push({ ...c, score: c.score * NOISE_SCORE_PENALTY, noise });
    }
  }

  return [...direct, ...noiseHits].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
}
