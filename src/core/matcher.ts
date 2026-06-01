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
 * Score multiplier per noise term subtracted. A single wreck (0.7^1) sits a
 * touch below a clean direct match; a 3-term explanation (0.7^3 ≈ 0.34) is
 * already half as plausible. Keeps the "fewer wrecks is more likely" prior.
 */
const NOISE_SCORE_PENALTY_PER_TERM = 0.7;

/**
 * Safety cap on subset size. Without a bound the subset-sum search would let
 * any RS reading "match" some ore by piling on enough wrecks; capping it at 4
 * keeps the search finite *and* preserves the prior that real-world readings
 * are dominated by ore plus at most a couple of overlapping non-ore signals.
 */
const MAX_NOISE_TERMS = 4;

/**
 * Enumerate every distinct sum of up to `maxTerms` values drawn (with
 * repetition) from `noises` and strictly less than `reading`. Returns
 * `{ sum, terms }` pairs sorted shortest-bag-first — the prior we use for
 * scoring (fewer terms ⇒ less penalty).
 *
 * The search is naturally pruned by `currentSum + k*v < reading`: if a partial
 * sum already meets the reading, no longer bag built on it can contribute.
 * For a typical noise list of 3–5 values and `maxTerms = 4` this is well
 * under a thousand candidate sums.
 */
function enumerateNoiseSums(
  noises: readonly number[],
  reading: number,
  maxTerms: number,
): Array<{ sum: number; terms: number[] }> {
  const distinct = [...new Set(noises)]
    .filter((n) => Number.isInteger(n) && n > 0 && n < reading)
    .sort((a, b) => a - b);
  if (distinct.length === 0) return [];

  // Map each sum to the *shortest* bag that produces it (longer bags would
  // only ever lose on penalty; no point keeping them).
  const best = new Map<number, number[]>();
  const visit = (i: number, currentSum: number, terms: number[]): void => {
    if (i >= distinct.length) return;
    // Branch 1: skip this noise value entirely.
    visit(i + 1, currentSum, terms);
    // Branch 2: include k = 1, 2, … copies of this noise value.
    const v = distinct[i];
    for (let k = 1; terms.length + k <= maxTerms; k++) {
      const newSum = currentSum + k * v;
      if (newSum >= reading) break;
      const bag = [...terms, ...new Array(k).fill(v)];
      const prev = best.get(newSum);
      if (!prev || bag.length < prev.length) best.set(newSum, bag);
      visit(i + 1, newSum, bag);
    }
  };
  visit(0, 0, []);

  return [...best.entries()]
    .map(([sum, terms]) => ({ sum, terms }))
    .sort((a, b) => a.terms.length - b.terms.length || a.sum - b.sum);
}

/**
 * Identify the ore(s) behind a reading, optionally after subtracting any
 * subset-sum of known non-ore "noise" signatures (wrecks, satellites, debris
 * panels). Subsets are taken with repetition up to MAX_NOISE_TERMS, so a
 * reading that conceals e.g. one 10k wreck plus two 2k panels still resolves.
 *
 * Star Citizen's scanner sometimes lumps these non-ore signals into the same
 * RS chip as the ore — e.g. an Iron ×3 (12,810) sitting next to a wreck reads
 * as 22,810. `matchOre` alone fails on that reading; this helper recovers it
 * by trying every plausible sum to subtract.
 *
 * Each noise-subtracted candidate is penalized by NOISE_SCORE_PENALTY_PER_TERM
 * raised to the bag size, so the simplest explanation (direct, then one
 * wreck, then two…) ranks first. Per (ore, nodes) the best explanation wins —
 * we don't list the same Iron ×3 twice under different wreck combinations.
 */
export function matchWithNoise(
  reading: number,
  table: SignatureTable | Deposit[],
  opts: MatchOptions,
  context: MatchContext = {},
  noises: readonly number[] = [],
): OreCandidate[] {
  if (!Number.isFinite(reading) || !Number.isInteger(reading) || reading < 1) return [];

  // Direct matches first — the no-noise hypothesis is the strongest prior.
  const byKey = new Map<string, OreCandidate>();
  for (const c of matchOre(reading, table, opts, context)) {
    byKey.set(`${c.name}|${c.nodes}`, { ...c, noise: null });
  }

  // Noise-subtracted matches: for each plausible noise sum, run the matcher
  // on (reading − sum) and fold the result into byKey, keeping the highest
  // score per (ore, nodes). The penalty grows with the bag size, so shorter
  // explanations naturally win even before sorting.
  for (const { sum, terms } of enumerateNoiseSums(noises, reading, MAX_NOISE_TERMS)) {
    const penalty = NOISE_SCORE_PENALTY_PER_TERM ** terms.length;
    for (const c of matchOre(reading - sum, table, opts, context)) {
      const k = `${c.name}|${c.nodes}`;
      const cand: OreCandidate = { ...c, score: c.score * penalty, noise: sum };
      const prev = byKey.get(k);
      if (!prev || cand.score > prev.score) byKey.set(k, cand);
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
}
