import { describe, expect, it } from 'vitest';

import { getQualityDetail } from '../src/core/quality';
import type { SignatureTable } from '../src/core/types';

const table: SignatureTable = {
  patch: 'fixture',
  generatedAt: '',
  source: '',
  methodsIncluded: ['Ship'],
  deposits: [
    {
      name: 'Aluminum',
      signature: 4285,
      methods: ['Ship'],
      clustering: { minSize: 4, maxSize: 6, probability: 1, params: [] },
      locations: [
        {
          system: 'Stanton System',
          name: 'Glaciem Ring',
          type: 'Asteroid',
          probability: 0.1,
          occurrence: 0.138,
        },
      ],
      materials: [
        {
          name: 'Aluminum (Ore)',
          minPercent: 39.2,
          maxPercent: 83.2,
          qualityMin: 245,
          qualityMax: 490,
          mean: 245,
          stddev: 70,
          quantized: [318, 511],
          instability: 0,
          resistance: -0.4,
        },
      ],
    },
  ],
};

describe('getQualityDetail', () => {
  it('returns cluster + material detail for a matched ore', () => {
    const d = getQualityDetail(table, 'Aluminum', 4285);
    expect(d).not.toBeNull();
    expect(d?.clusterMin).toBe(4);
    expect(d?.clusterMax).toBe(6);
    expect(d?.clusterProbability).toBe(1);
    expect(d?.materials[0]).toMatchObject({ name: 'Aluminum (Ore)', quantized: [318, 511] });
    expect(d?.location).toBeUndefined(); // no location requested
  });

  it('scopes to a location when given', () => {
    const d = getQualityDetail(table, 'Aluminum', 4285, 'Glaciem Ring');
    expect(d?.location).toMatchObject({
      name: 'Glaciem Ring',
      type: 'Asteroid',
      spawn: 0.1,
      occurrence: 0.138,
    });
  });

  it('returns null when the deposit is absent (or signature mismatches)', () => {
    expect(getQualityDetail(table, 'Iron', 4270)).toBeNull();
    expect(getQualityDetail(table, 'Aluminum', 9999)).toBeNull();
  });
});
