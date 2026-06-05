import { describe, expect, it } from 'vitest';

import { parseDistanceToken, parsePos, parsePosLine, parseSystemName } from '../src/core/coords';

// The real debug-overlay block from the user's HUD (relevant lines).
const SAMPLE = [
  'Zone: ARGO_MOLE_Teach_372772292218 Pos: -1.00m 20.15m 0.78m',
  'Zone: glaciemring_segment_mission_genrl_002-022 Pos: 46.6484km 106.5163km 734.87m',
  'Zone: SolarSystem_285626946665 Pos: -14215974.6126km -4787767.8108km 734.87m',
  'Zone: Root Pos: -14215974.6126km -4787767.8108km 734.87m',
  'Current player location : NyxSolarSystem',
  'No Current Planet',
].join('\n');

// A second real capture: a different system, Z in km this time, and a large
// (hundreds of km) Microtech row that must NOT be mistaken for the system frame.
const SAMPLE2 = [
  'Zone: ARGO_MOLE_Teach_380173754363 Pos: -1.00m 20.15m 0.78m',
  'Zone: OOC_Stanton_4_Microtech Pos: 547.3048km 532.8736km 823.2152km',
  'Zone: SolarSystem_286442628222 Pos: 22462765.8040km 37185398.0550km 823.2152km',
  'Zone: Root Pos: 22462765.8040km 37185398.0550km 823.2152km',
  'Current player location : Stanton4',
].join('\n');

describe('parseDistanceToken', () => {
  it('applies the per-token metric unit', () => {
    expect(parseDistanceToken('734.87m')).toBeCloseTo(734.87, 5);
    expect(parseDistanceToken('46.6484km')).toBeCloseTo(46648.4, 3);
    expect(parseDistanceToken('2Mm')).toBe(2_000_000);
    expect(parseDistanceToken('3Gm')).toBe(3_000_000_000);
  });

  it('handles negatives, decimals, spaces, commas, and a unicode minus', () => {
    expect(parseDistanceToken('-14215974.6126km')).toBeCloseTo(-14_215_974_612.6, 0);
    expect(parseDistanceToken('20.15 m')).toBeCloseTo(20.15, 5);
    expect(parseDistanceToken('1,234km')).toBe(1_234_000);
    expect(parseDistanceToken('−5km')).toBe(-5_000);
  });

  it('treats a bare number as meters', () => {
    expect(parseDistanceToken('20.15')).toBeCloseTo(20.15, 5);
    expect(parseDistanceToken('-1.00')).toBe(-1);
  });

  it('rejects non-numbers and unknown units', () => {
    expect(parseDistanceToken('')).toBeNull();
    expect(parseDistanceToken('abc')).toBeNull();
    expect(parseDistanceToken('5lightyears')).toBeNull();
    expect(parseDistanceToken('5km extra')).toBeNull();
  });
});

describe('parsePosLine', () => {
  it('parses a "Zone: … Pos: x y z" line into zone + meters', () => {
    const r = parsePosLine(
      'Zone: SolarSystem_285626946665 Pos: -14215974.6126km -4787767.8108km 734.87m',
    );
    expect(r).not.toBeNull();
    expect(r!.zone).toBe('SolarSystem_285626946665');
    expect(r!.pos.x).toBeCloseTo(-14_215_974_612.6, 0);
    expect(r!.pos.y).toBeCloseTo(-4_787_767_810.8, 0);
    expect(r!.pos.z).toBeCloseTo(734.87, 2);
  });

  it('does not mistake digits in the zone id for coordinates', () => {
    const r = parsePosLine('Zone: ARGO_MOLE_Teach_372772292218 Pos: -1.00m 20.15m 0.78m');
    expect(r!.zone).toBe('ARGO_MOLE_Teach_372772292218');
    expect(r!.pos).toEqual({ x: -1, y: 20.15, z: 0.78 });
  });

  it('reads a line that has no "Zone:" label', () => {
    const r = parsePosLine('SolarSystem_285626946665 Pos: 1km 2km 3km');
    expect(r!.zone).toBe('SolarSystem_285626946665');
    expect(r!.pos).toEqual({ x: 1000, y: 2000, z: 3000 });
  });

  it('applies each axis unit independently (km / m / km on one line)', () => {
    const r = parsePosLine('Zone: SolarSystem_1 Pos: 1km 500m 2km')!;
    expect(r.pos).toEqual({ x: 1000, y: 500, z: 2000 });
  });

  it('reads numbers-only text (no anchor) using unit-bearing tokens', () => {
    const r = parsePosLine('-14215974.6126km -4787767.8108km 734.87m');
    expect(r!.zone).toBe('');
    expect(r!.pos.x).toBeCloseTo(-14_215_974_612.6, 0);
    expect(r!.pos.z).toBeCloseTo(734.87, 2);
  });

  it('returns null with fewer than three coordinates', () => {
    expect(parsePosLine('Pos: 10km 20km')).toBeNull();
    expect(parsePosLine('no numbers here')).toBeNull();
  });
});

describe('parsePos', () => {
  it('picks the SolarSystem line from the full overlay block by default', () => {
    const r = parsePos(SAMPLE);
    expect(r!.zone).toBe('SolarSystem_285626946665');
    expect(r!.pos.x).toBeCloseTo(-14_215_974_612.6, 0);
  });

  it('honors an explicit preferred zone', () => {
    const r = parsePos(SAMPLE, { preferZone: 'glaciem' });
    expect(r!.zone).toContain('glaciemring');
    expect(r!.pos.x).toBeCloseTo(46_648.4, 3);
  });

  it('falls back to the Root line when the preferred zone is absent', () => {
    const text = [
      'Zone: ARGO_MOLE_Teach_372772292218 Pos: -1.00m 20.15m 0.78m',
      'Zone: Root Pos: 5km 6km 7km',
    ].join('\n');
    const r = parsePos(text);
    expect(r!.zone).toBe('Root');
    expect(r!.pos).toEqual({ x: 5000, y: 6000, z: 7000 });
  });

  it('falls back to the largest-magnitude reading when zones are unlabeled', () => {
    const text = ['1km 0m 0m', '10km 0m 0m'].join('\n');
    const r = parsePos(text);
    expect(r!.pos.x).toBe(10_000);
  });

  it('picks SolarSystem from a multi-row capture with km Z and a large Microtech row', () => {
    const r = parsePos(SAMPLE2)!;
    expect(r.zone).toBe('SolarSystem_286442628222');
    expect(r.pos.x).toBeCloseTo(22_462_765_804.0, 0);
    expect(r.pos.y).toBeCloseTo(37_185_398_055.0, 0);
    expect(r.pos.z).toBeCloseTo(823_215.2, 1);
  });

  it('still finds SolarSystem when the rows are flattened into one line (OCR fragmentation)', () => {
    const r = parsePos(SAMPLE2.replace(/\n/g, ' '))!;
    // Must anchor on SolarSystem, not grab the first (ARGO) row's tiny numbers.
    expect(r.pos.x).toBeCloseTo(22_462_765_804.0, 0);
    expect(r.zone).toContain('SolarSystem');
  });

  it('returns null when no line has three coordinates', () => {
    expect(parsePos('nothing\nuseful here')).toBeNull();
  });
});

describe('parseSystemName', () => {
  it('reads the "Current player location" line', () => {
    expect(parseSystemName('Current player location : NyxSolarSystem')).toBe('NyxSolarSystem');
  });

  it('reads a box that contains only the name', () => {
    expect(parseSystemName('  StantonSolarSystem  ')).toBe('StantonSolarSystem');
  });

  it('returns null for empty text', () => {
    expect(parseSystemName('   ')).toBeNull();
  });
});
