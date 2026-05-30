// Table loader + location grouping. Pure helpers the renderer uses to load a
// crawled signature table and build the System → location dropdown (Phase 2).

import type { Deposit, SignatureTable } from './types';

/**
 * Validate and normalize a parsed JSON value into a `SignatureTable`.
 * Throws on a structurally invalid table (missing `deposits` array).
 */
export function loadSignatureTable(raw: unknown): SignatureTable {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid signature table: expected an object.');
  }
  const t = raw as Partial<SignatureTable>;
  if (!Array.isArray(t.deposits)) {
    throw new Error('Invalid signature table: "deposits" must be an array.');
  }
  return {
    patch: t.patch ?? 'unknown',
    generatedAt: t.generatedAt ?? '',
    source: t.source ?? '',
    methodsIncluded: t.methodsIncluded ?? [],
    deposits: t.deposits as Deposit[],
  };
}

/** A system and the location names within it that host deposits. */
export interface SystemGroup {
  system: string;
  locations: string[];
}

/**
 * Group every deposit location by system, de-duplicating names. Both systems
 * and locations come back sorted, ready for a System → location dropdown.
 */
export function groupLocations(table: SignatureTable): SystemGroup[] {
  const bySystem = new Map<string, Set<string>>();
  for (const deposit of table.deposits) {
    for (const loc of deposit.locations) {
      let names = bySystem.get(loc.system);
      if (!names) {
        names = new Set<string>();
        bySystem.set(loc.system, names);
      }
      names.add(loc.name);
    }
  }
  return [...bySystem.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([system, names]) => ({
      system,
      locations: [...names].sort((a, b) => a.localeCompare(b)),
    }));
}
