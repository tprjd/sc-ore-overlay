import { describe, it, expect } from 'vitest';

import { parseScanResult } from '../src/core/scan';

// The real SCAN RESULTS panel from the user's HUD.
const SAMPLE = [
  'SCAN RESULTS',
  'IRON (ORE) [CF]',
  'MASS: 35111',
  'RESISTANCE: 0%',
  'INSTABILITY: 42.24',
  'COMPOSITION 37.51 SCU',
  '12.55% IRON (ORE) [CF] 664',
  '68.20% IRON (ORE) [CF] 325',
  '19.23% INERT MATERIALS 0',
].join('\n');

describe('parseScanResult', () => {
  it('reads the ore name (cleaned + raw)', () => {
    const r = parseScanResult(SAMPLE)!;
    expect(r.ore).toBe('Iron');
    expect(r.oreRaw).toBe('IRON (ORE) [CF]');
  });

  it('reads mass, resistance, instability, and SCU', () => {
    const r = parseScanResult(SAMPLE)!;
    expect(r.mass).toBe(35111);
    expect(r.resistance).toBe(0);
    expect(r.instability).toBeCloseTo(42.24, 2);
    expect(r.scu).toBeCloseTo(37.51, 2);
  });

  it('reads the composition rows (percent, material, quality)', () => {
    const r = parseScanResult(SAMPLE)!;
    expect(r.composition.map((c) => ({ percent: c.percent, material: c.material, quality: c.quality }))).toEqual([
      { percent: 12.55, material: 'IRON (ORE) [CF]', quality: 664 },
      { percent: 68.2, material: 'IRON (ORE) [CF]', quality: 325 },
      { percent: 19.23, material: 'INERT MATERIALS', quality: 0 },
    ]);
  });

  it('derives each row’s SCU from its percent of the total SCU', () => {
    const r = parseScanResult(SAMPLE)!;
    expect(r.composition[0].scu).toBeCloseTo(4.71, 2); // 12.55% of 37.51
    expect(r.composition[1].scu).toBeCloseTo(25.58, 2); // 68.20% of 37.51
    expect(r.composition[2].scu).toBeCloseTo(7.21, 2); // 19.23% of 37.51
  });

  it('works when the panel title is not captured; SCU undefined without a total', () => {
    const r = parseScanResult('QUANTANIUM (ORE)\nMASS: 1200\n45.0% QUANTANIUM (ORE) 90')!;
    expect(r.ore).toBe('Quantanium');
    expect(r.mass).toBe(1200);
    expect(r.composition).toHaveLength(1);
    expect(r.composition[0].scu).toBeUndefined();
  });

  it('returns null when there is no ore line', () => {
    expect(parseScanResult('SCAN RESULTS\nMASS: 10\nCOMPOSITION 5 SCU')).toBeNull();
    expect(parseScanResult('')).toBeNull();
  });
});
