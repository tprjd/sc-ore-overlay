import { describe, it, expect } from 'vitest';

import { matchOre, matchWithNoise, clusterProb } from '../src/core/matcher';
import type { Clustering } from '../src/core/types';
import {
  fixtureTable,
  sharedSignatureTable,
  sameNameTable,
} from './fixtures/table.fixture';

const ship = { method: 'Ship' } as const;

describe('matchOre', () => {
  it('finds a clean match (Iron ×5 from 21350 = 4270 × 5)', () => {
    const result = matchOre(21350, fixtureTable, ship);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Iron', nodes: 5, signature: 4270 });
    expect(result[0].score).toBeGreaterThan(0);
  });

  it('returns BOTH ores on overlap (12004 → Aurorite ×4 and Beryl ×2)', () => {
    const result = matchOre(12004, fixtureTable, ship);
    expect(result).toHaveLength(2);
    const byName = Object.fromEntries(result.map((c) => [c.name, c]));
    expect(byName.Aurorite.nodes).toBe(4);
    expect(byName.Beryl.nodes).toBe(2);
    // Results are sorted by score descending.
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    expect(result[0].name).toBe('Aurorite');
  });

  it('returns both ores when they share a signature (14700 = 4900 × 3)', () => {
    const result = matchOre(14700, sharedSignatureTable, ship);
    expect(result).toHaveLength(2);
    expect(new Set(result.map((c) => c.name))).toEqual(new Set(['Gold', 'Laranite']));
    expect(result.every((c) => c.nodes === 3)).toBe(true);
  });

  it('rejects a candidate below the cluster minimum (Tin ×1, min 2)', () => {
    // 7919 = 7919 × 1, but Tin requires at least 2 nodes.
    const result = matchOre(7919, fixtureTable, ship);
    expect(result.find((c) => c.name === 'Tin')).toBeUndefined();
    expect(result).toHaveLength(0);
  });

  it('rejects a candidate above the cluster maximum (Tin ×5, max 4)', () => {
    // 39595 = 7919 × 5, but Tin allows at most 4 nodes.
    const result = matchOre(39595, fixtureTable, ship);
    expect(result.find((c) => c.name === 'Tin')).toBeUndefined();
    expect(result).toHaveLength(0);
  });

  it('filters by location, narrowing an overlap to one ore', () => {
    // Without a location both qualify; Checkmate hosts only Aurorite.
    const anywhere = matchOre(12004, fixtureTable, ship);
    expect(anywhere).toHaveLength(2);

    const atCheckmate = matchOre(12004, fixtureTable, ship, { location: 'Checkmate' });
    expect(atCheckmate).toHaveLength(1);
    expect(atCheckmate[0].name).toBe('Aurorite');
  });

  it('excludes non-Ship deposits under method "Ship"', () => {
    // 7000 = 3500 × 2 matches Diamond, which is FPS-only.
    expect(matchOre(7000, fixtureTable, { method: 'Ship' })).toHaveLength(0);

    const fps = matchOre(7000, fixtureTable, { method: 'FPS' });
    expect(fps).toHaveLength(1);
    expect(fps[0]).toMatchObject({ name: 'Diamond', nodes: 2 });
  });

  it('tolerates small error within relTol but rejects beyond it', () => {
    // 21380 is within 0.2% of 4270 × 5 = 21350.
    const near = matchOre(21380, fixtureTable, ship);
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ name: 'Iron', nodes: 5 });

    // 21550 is ~0.93% off — beyond the default tolerance.
    expect(matchOre(21550, fixtureTable, ship)).toHaveLength(0);

    // ...but a looser tolerance accepts it.
    const loose = matchOre(21550, fixtureTable, { method: 'Ship', relTol: 0.01 });
    expect(loose).toHaveLength(1);
    expect(loose[0]).toMatchObject({ name: 'Iron', nodes: 5 });
  });

  it('returns nothing for a reading that matches no deposit', () => {
    expect(matchOre(9999, fixtureTable, ship)).toHaveLength(0);
    expect(matchOre(9999, fixtureTable, { method: 'FPS' })).toHaveLength(0);
  });

  it('merges multiple deposit rows of the same ore, keeping the best score', () => {
    // Both Polaris rows match 8000 (×4 and ×2); they collapse to one entry.
    const result = matchOre(8000, sameNameTable, ship);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Polaris');
    expect(result[0].nodes).toBe(2); // the higher-scoring (sig 4000) row wins
  });

  it('rejects structurally invalid readings', () => {
    expect(matchOre(0, fixtureTable, ship)).toHaveLength(0);
    expect(matchOre(-5, fixtureTable, ship)).toHaveLength(0);
    expect(matchOre(3.5, fixtureTable, ship)).toHaveLength(0);
    expect(matchOre(Number.NaN, fixtureTable, ship)).toHaveLength(0);
  });

  it('accepts a plain Deposit[] as well as a SignatureTable', () => {
    const result = matchOre(21350, fixtureTable.deposits, ship);
    expect(result[0]).toMatchObject({ name: 'Iron', nodes: 5 });
  });
});

describe('matchWithNoise', () => {
  it('matches the raw reading without subtracting when a clean match exists', () => {
    const result = matchWithNoise(21350, fixtureTable, ship, {}, [10_000]);
    expect(result[0]).toMatchObject({ name: 'Iron', nodes: 5, noise: null });
  });

  it('finds the ore behind a wreck-corrupted reading by subtracting noise', () => {
    // 21350 (Iron ×5) + 10000 wreck = 31350. Bare matchOre fails; noise wrapper recovers it.
    expect(matchOre(31350, fixtureTable, ship)).toHaveLength(0);
    const result = matchWithNoise(31350, fixtureTable, ship, {}, [10_000]);
    expect(result[0]).toMatchObject({ name: 'Iron', nodes: 5, noise: 10_000 });
  });

  it('applies a multiplicative penalty to noise-subtracted scores', () => {
    // matchOre(R-noise) gives the un-penalized score; matchWithNoise must
    // report that score × 0.7 for the noise hit.
    const base = matchOre(21350, fixtureTable, ship)[0].score;
    const noisy = matchWithNoise(31350, fixtureTable, ship, {}, [10_000])[0];
    expect(noisy.noise).toBe(10_000);
    expect(noisy.score).toBeCloseTo(base * 0.7, 10);
  });

  it('ignores noise values that are non-positive, non-integer, or >= the reading', () => {
    const a = matchWithNoise(21350, fixtureTable, ship, {}, [0, -10, 1.5, 21350, 99_999]);
    const b = matchOre(21350, fixtureTable, ship);
    expect(a.map((r) => ({ name: r.name, nodes: r.nodes }))).toEqual(
      b.map((r) => ({ name: r.name, nodes: r.nodes })),
    );
    // All resulting entries should be marked as direct (noise == null).
    expect(a.every((r) => r.noise == null)).toBe(true);
  });

  it('returns [] when neither the raw reading nor any subtraction matches', () => {
    expect(matchWithNoise(9999, fixtureTable, ship, {}, [1, 2, 3])).toHaveLength(0);
  });

  it('subtracts multiples of a noise value (Iron ×5 + 2×10000 = 41350)', () => {
    expect(matchOre(41350, fixtureTable, ship)).toHaveLength(0);
    const r = matchWithNoise(41350, fixtureTable, ship, {}, [10_000]);
    expect(r[0]).toMatchObject({ name: 'Iron', nodes: 5, noise: 20_000 });
    // Two terms ⇒ score is the direct score × 0.7^2.
    const base = matchOre(21350, fixtureTable, ship)[0].score;
    expect(r[0].score).toBeCloseTo(base * 0.7 * 0.7, 10);
  });

  it('subtracts subset-sums across distinct noise values (10000 + 2000)', () => {
    // 21350 (Iron ×5) + 10000 + 2000 = 33350. Neither value alone resolves —
    // 33350 - 10000 = 23350; 33350 - 2000 = 31350; only 10000+2000 = 12000
    // brings it back to 21350.
    expect(matchOre(33350, fixtureTable, ship)).toHaveLength(0);
    expect(matchOre(23350, fixtureTable, ship)).toHaveLength(0);
    expect(matchOre(31350, fixtureTable, ship)).toHaveLength(0);
    const r = matchWithNoise(33350, fixtureTable, ship, {}, [2_000, 10_000]);
    expect(r[0]).toMatchObject({ name: 'Iron', nodes: 5, noise: 12_000 });
  });

  it('prefers the shorter noise explanation when several work', () => {
    // 21350 (Iron ×5) + 10000 = 31350. With noises [5000, 10000] both 10000
    // and 5000+5000 explain the reading; the single-term hypothesis must win.
    const r = matchWithNoise(31350, fixtureTable, ship, {}, [5_000, 10_000]);
    expect(r[0]).toMatchObject({ name: 'Iron', nodes: 5, noise: 10_000 });
  });
});

describe('clusterProb', () => {
  const iron: Clustering = {
    minSize: 4,
    maxSize: 6,
    params: [
      { minSize: 4, maxSize: 4, relativeProbability: 0.6 },
      { minSize: 5, maxSize: 5, relativeProbability: 0.3 },
      { minSize: 6, maxSize: 6, relativeProbability: 0.1 },
    ],
  };

  it('returns the per-size weight (params already sum to 1)', () => {
    expect(clusterProb(iron, 4)).toBeCloseTo(0.6, 10);
    expect(clusterProb(iron, 5)).toBeCloseTo(0.3, 10);
    expect(clusterProb(iron, 6)).toBeCloseTo(0.1, 10);
  });

  it('normalizes weights that do not sum to 1', () => {
    const cl: Clustering = {
      minSize: 1,
      maxSize: 3,
      params: [
        { minSize: 1, maxSize: 1, relativeProbability: 2 },
        { minSize: 2, maxSize: 2, relativeProbability: 2 },
        { minSize: 3, maxSize: 3, relativeProbability: 6 },
      ],
    };
    expect(clusterProb(cl, 3)).toBeCloseTo(0.6, 10); // 6 / (2+2+6)
  });

  it('is uniform over the range when there are no params', () => {
    const cl: Clustering = { minSize: 1, maxSize: 4, params: [] };
    expect(clusterProb(cl, 2)).toBeCloseTo(0.25, 10);
  });

  it('returns a tiny positive weight for a size in range but in no bucket', () => {
    const cl: Clustering = {
      minSize: 1,
      maxSize: 5,
      params: [{ minSize: 1, maxSize: 2, relativeProbability: 1 }],
    };
    const p = clusterProb(cl, 4);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-9);
  });
});
