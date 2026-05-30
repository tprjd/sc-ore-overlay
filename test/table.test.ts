import { describe, it, expect } from 'vitest';

import { loadSignatureTable, groupLocations } from '../src/core/table';
import { fixtureTable } from './fixtures/table.fixture';

describe('loadSignatureTable', () => {
  it('passes through a valid table and fills defaults', () => {
    const t = loadSignatureTable({ deposits: [] });
    expect(t.deposits).toEqual([]);
    expect(t.patch).toBe('unknown');
  });

  it('throws on a structurally invalid table', () => {
    expect(() => loadSignatureTable(null)).toThrow();
    expect(() => loadSignatureTable({})).toThrow();
    expect(() => loadSignatureTable({ deposits: 'nope' })).toThrow();
  });
});

describe('groupLocations', () => {
  it('groups location names by system, sorted and de-duplicated', () => {
    const groups = groupLocations(fixtureTable);
    const systems = groups.map((g) => g.system);
    expect(systems).toEqual(['Pyro System', 'Stanton System']);

    const stanton = groups.find((g) => g.system === 'Stanton System');
    // Daymar hosts both Quartz and Diamond but appears once.
    expect(stanton?.locations).toContain('Daymar');
    expect(stanton?.locations.filter((l) => l === 'Daymar')).toHaveLength(1);

    const pyro = groups.find((g) => g.system === 'Pyro System');
    expect(pyro?.locations).toEqual(['Checkmate']);
  });
});
