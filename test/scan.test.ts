import { describe, it, expect } from 'vitest';

import { parseScanResult, snapMaterial } from '../src/core/scan';

const ORE_VOCAB = [
  'Agricium',
  'Aluminum',
  'Aslarite',
  'Beryl',
  'Bexalite',
  'Borase',
  'Copper',
  'Corundum',
  'Gold',
  'Hephaestanite',
  'Ice',
  'Iron',
  'Laranite',
  'Quantainium',
  'Quartz',
  'Riccite',
  'Silicon',
  'Stileron',
  'Taranite',
  'Tin',
  'Titanium',
  'Tungsten',
];

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

  it('rejects HUD junk when no panel signal is present (strict, default)', () => {
    // A stray letter-line with no header / mass / scu / composition row — the
    // scan region pointed at the HUD with no SCAN RESULTS panel up.
    expect(parseScanResult('QUANTANIUM')).toBeNull();
    expect(parseScanResult('SOME RANDOM HUD TEXT\nMORE JUNK')).toBeNull();
  });

  it('parses a partial panel when at least one signal is present', () => {
    // Header missing but MASS present — still a real (if degraded) panel.
    const r = parseScanResult('IRON (ORE) [CF]\nMASS: 35111')!;
    expect(r).not.toBeNull();
    expect(r.ore).toBe('Iron');
  });

  it('loose mode keeps the legacy first-letter-line behavior', () => {
    const r = parseScanResult('QUANTANIUM', { strict: false })!;
    expect(r).not.toBeNull();
    expect(r.oreRaw).toBe('QUANTANIUM');
  });

  it('reads rows with the quality glued to the material, and a no-number row', () => {
    const text = [
      'SCAN RESULTS',
      'ASLARITE (RAW) [CF]',
      'COMPOSITION 34.31 SCU',
      '61.66% ASLARITE(RAW)[CF]287',
      '3.18% AGRICIUM(ORE)[CF]667',
      '4.53% TITANIUM(ORE)[CF] 516',
      '25.85% INERTMATERIALS',
    ].join('\n');
    const r = parseScanResult(text)!;
    expect(r.ore).toBe('Aslarite');
    expect(r.composition).toHaveLength(4);
    expect(r.composition[0]).toMatchObject({ percent: 61.66, material: 'ASLARITE(RAW)[CF]', quality: 287 });
    expect(r.composition[1]).toMatchObject({ percent: 3.18, material: 'AGRICIUM(ORE)[CF]', quality: 667 });
    expect(r.composition[2]).toMatchObject({ percent: 4.53, material: 'TITANIUM(ORE)[CF]', quality: 516 });
    expect(r.composition[3]).toMatchObject({ percent: 25.85, material: 'INERTMATERIALS', quality: 0 });
    expect(r.composition[0].scu).toBeCloseTo(21.15, 1); // 61.66% of 34.31
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

describe('snapMaterial', () => {
  it('maps "INERT MATERIALS" and its OCR variants to "Inert"', () => {
    expect(snapMaterial('INERT MATERIALS', ORE_VOCAB)).toBe('Inert');
    expect(snapMaterial('Inertmaterials', ORE_VOCAB)).toBe('Inert');
    expect(snapMaterial('inert', ORE_VOCAB)).toBe('Inert');
  });

  it('corrects one-letter OCR typos to the closest ore name', () => {
    expect(snapMaterial('Agricius', ORE_VOCAB)).toBe('Agricium');
    expect(snapMaterial('Quantanium', ORE_VOCAB)).toBe('Quantainium'); // missing 'i'
    expect(snapMaterial('Berylicf', ORE_VOCAB)).toBe('Beryl');
  });

  it('strips ASCII + unicode brackets before matching', () => {
    expect(snapMaterial('TITANIUM (ORE) [CF]', ORE_VOCAB)).toBe('Titanium');
    expect(snapMaterial('Titanium【Cf】', ORE_VOCAB)).toBe('Titanium');
    expect(snapMaterial('Aslarite【Cf】S', ORE_VOCAB)).toBe('Aslarite');
  });

  it('absorbs unmatched bracket leakage like "Titaniumicf)"', () => {
    expect(snapMaterial('Titaniumicf)', ORE_VOCAB)).toBe('Titanium');
    expect(snapMaterial('Titanium【Cf)', ORE_VOCAB)).toBe('Titanium');
  });

  it('falls back to the cleaned raw when nothing is close enough', () => {
    expect(snapMaterial('Frobnicator', ORE_VOCAB)).toBe('Frobnicator');
    expect(snapMaterial('xyzzy', ORE_VOCAB)).toBe('Xyzzy');
  });
});
