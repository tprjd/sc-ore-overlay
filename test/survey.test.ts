import { describe, it, expect } from 'vitest';

import {
  makeEntry,
  distance,
  project,
  dedupeEntries,
  mergeEntries,
  filterBySystem,
} from '../src/core/survey';
import type { SurveyEntry, NewEntryInput } from '../src/core/survey';
import type { OreCandidate } from '../src/core/types';

const iron: OreCandidate = { name: 'Iron', nodes: 4, score: 0.9, signature: 4270 };
const quant: OreCandidate = { name: 'Quantanium', nodes: 2, score: 0.4, signature: 5000 };

const baseInput: NewEntryInput = {
  id: 'e1',
  ts: 1000,
  scout: 'Falcon',
  system: 'NyxSolarSystem',
  pos: { x: 100, y: 200, z: 300 },
  rs: 17080,
  candidates: [iron, quant],
};

// Minimal entry literal for the merge/dedupe/filter tests.
function entry(id: string, over: Partial<SurveyEntry> = {}): SurveyEntry {
  return {
    id,
    ts: 0,
    scout: 'X',
    system: 'NyxSolarSystem',
    pos: { x: 0, y: 0, z: 0 },
    rs: 0,
    candidates: [],
    source: 'local',
    ...over,
  };
}

describe('makeEntry', () => {
  it('derives the primary ore and node count from the top candidate', () => {
    const e = makeEntry(baseInput);
    expect(e.ore).toBe('Iron');
    expect(e.nodes).toBe(4);
    expect(e.candidates).toHaveLength(2);
    expect(e.source).toBe('local');
  });

  it('leaves ore/nodes undefined when there are no candidates', () => {
    const e = makeEntry({ ...baseInput, candidates: [] });
    expect(e.ore).toBeUndefined();
    expect(e.nodes).toBeUndefined();
  });

  it('honors an explicit source', () => {
    expect(makeEntry({ ...baseInput, source: 'peer' }).source).toBe('peer');
  });
});

describe('distance', () => {
  it('is the euclidean distance in meters', () => {
    expect(distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
    expect(distance({ x: 1, y: 2, z: 2 }, { x: 0, y: 0, z: 0 })).toBe(3);
  });
});

describe('project', () => {
  const pos = { x: 100, y: 200, z: 300 };
  const center = { x: 10, y: 20, z: 30 };

  it('defaults to the X/Y plane with Z as depth, relative to center', () => {
    expect(project(pos, center)).toEqual({ x: 90, y: 180, depth: 270 });
  });

  it('supports the X/Z plane (Y depth)', () => {
    expect(project(pos, center, 'xz')).toEqual({ x: 90, y: 270, depth: 180 });
  });

  it('supports the Y/Z plane (X depth)', () => {
    expect(project(pos, center, 'yz')).toEqual({ x: 180, y: 270, depth: 90 });
  });
});

describe('dedupeEntries', () => {
  it('keeps the first occurrence per id', () => {
    const out = dedupeEntries([entry('a', { rs: 1 }), entry('a', { rs: 99 }), entry('b', { rs: 2 })]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.id === 'a')!.rs).toBe(1);
  });
});

describe('mergeEntries', () => {
  it('adds new ids and keeps the existing entry on a clash', () => {
    const existing = [entry('a', { rs: 1 })];
    const incoming = [entry('a', { rs: 99 }), entry('b', { rs: 2 })];
    const out = mergeEntries(existing, incoming);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.id === 'a')!.rs).toBe(1);
    expect(out.find((e) => e.id === 'b')!.rs).toBe(2);
  });
});

describe('filterBySystem', () => {
  it('keeps only entries of the given system', () => {
    const out = filterBySystem(
      [entry('a', { system: 'NyxSolarSystem' }), entry('b', { system: 'StantonSolarSystem' })],
      'NyxSolarSystem',
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });
});
