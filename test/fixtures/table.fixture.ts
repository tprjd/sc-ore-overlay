// Hand-built signature table for matcher tests. Signatures are spread out (and
// some are prime) so each scenario's target reading matches only its intended
// deposit(s) — no accidental cross-matches. Verified by hand in the tests.
//
// Key readings:
//   21350 = 4270 × 5         → Iron ×5            (clean match)
//   12004 ≈ 3001 × 4 / 6007 × 2 → Aurorite ×4 + Beryl ×2 (overlap, two ores)
//    7000 = 3500 × 2         → Diamond ×2 (FPS only; excluded under "Ship")
//    7919 = 7919 × 1         → Tin rejected (below cluster min 2)
//   39595 = 7919 × 5         → Tin rejected (above cluster max 4)
//    9999                    → no match

import type { SignatureTable } from '../../src/core/types';

export const fixtureTable: SignatureTable = {
  patch: 'fixture',
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'fixture',
  methodsIncluded: ['Ship', 'FPS'],
  deposits: [
    {
      name: 'Iron',
      signature: 4270,
      methods: ['Ship'],
      clustering: {
        minSize: 4,
        maxSize: 6,
        params: [
          { minSize: 4, maxSize: 4, relativeProbability: 0.6 },
          { minSize: 5, maxSize: 5, relativeProbability: 0.3 },
          { minSize: 6, maxSize: 6, relativeProbability: 0.1 },
        ],
      },
      locations: [
        { system: 'Stanton System', name: 'ARC L3', probability: 0.1 },
        { system: 'Stanton System', name: 'Aaron Halo', probability: 0.3 },
      ],
    },
    {
      name: 'Quartz',
      signature: 4700,
      methods: ['Ship'],
      clustering: { minSize: 1, maxSize: 8, params: [] },
      locations: [{ system: 'Stanton System', name: 'Daymar', probability: 0.2 }],
    },
    {
      name: 'Aurorite',
      signature: 3001,
      methods: ['Ship'],
      clustering: {
        minSize: 1,
        maxSize: 10,
        params: [
          { minSize: 1, maxSize: 5, relativeProbability: 0.7 },
          { minSize: 6, maxSize: 10, relativeProbability: 0.3 },
        ],
      },
      // Spawns at Checkmate only — used by the location-narrowing test.
      locations: [{ system: 'Pyro System', name: 'Checkmate', probability: 0.2 }],
    },
    {
      name: 'Beryl',
      signature: 6007,
      methods: ['Ship'],
      clustering: {
        minSize: 1,
        maxSize: 5,
        params: [
          { minSize: 1, maxSize: 2, relativeProbability: 0.5 },
          { minSize: 3, maxSize: 5, relativeProbability: 0.5 },
        ],
      },
      // Spawns at Yela — NOT Checkmate, so the location filter drops it.
      locations: [{ system: 'Stanton System', name: 'Yela', probability: 0.25 }],
    },
    {
      name: 'Tin',
      signature: 7919,
      methods: ['Ship'],
      clustering: {
        minSize: 2,
        maxSize: 4,
        params: [
          { minSize: 2, maxSize: 2, relativeProbability: 0.5 },
          { minSize: 3, maxSize: 4, relativeProbability: 0.5 },
        ],
      },
      locations: [{ system: 'Stanton System', name: 'Brio’s Breaker', probability: 0.1 }],
    },
    {
      name: 'Diamond',
      signature: 3500,
      methods: ['FPS'], // not ship-mineable — excluded under method "Ship"
      clustering: { minSize: 1, maxSize: 5, params: [] },
      locations: [{ system: 'Stanton System', name: 'Daymar', probability: 0.2 }],
    },
  ],
};

/** Two different ores sharing one signature — both qualify for 14700 (= 4900×3). */
export const sharedSignatureTable: SignatureTable = {
  patch: 'fixture',
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'fixture',
  methodsIncluded: ['Ship'],
  deposits: [
    {
      name: 'Gold',
      signature: 4900,
      methods: ['Ship'],
      clustering: { minSize: 1, maxSize: 5, params: [] },
      locations: [{ system: 'Stanton System', name: 'Wala', probability: 0.5 }],
    },
    {
      name: 'Laranite',
      signature: 4900,
      methods: ['Ship'],
      clustering: { minSize: 1, maxSize: 5, params: [] },
      locations: [{ system: 'Stanton System', name: 'Lyria', probability: 0.5 }],
    },
  ],
};

/**
 * The same ore as two deposit rows (different signatures), both matching 8000.
 * Used to prove matchOre merges by ore name and keeps the higher-scoring entry
 * (the sig-4000 row scores higher here, so the merged result is Polaris ×2).
 */
export const sameNameTable: SignatureTable = {
  patch: 'fixture',
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'fixture',
  methodsIncluded: ['Ship'],
  deposits: [
    {
      name: 'Polaris',
      signature: 2000,
      methods: ['Ship'],
      clustering: {
        minSize: 1,
        maxSize: 10,
        params: [
          { minSize: 4, maxSize: 4, relativeProbability: 0.5 },
          { minSize: 1, maxSize: 3, relativeProbability: 0.5 },
        ],
      },
      locations: [{ system: 'Stanton System', name: 'A', probability: 1 }],
    },
    {
      name: 'Polaris',
      signature: 4000,
      methods: ['Ship'],
      clustering: {
        minSize: 1,
        maxSize: 10,
        params: [{ minSize: 2, maxSize: 2, relativeProbability: 1 }],
      },
      locations: [{ system: 'Stanton System', name: 'A', probability: 1 }],
    },
  ],
};
