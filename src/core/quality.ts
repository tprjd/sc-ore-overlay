// Quality/composition detail for a matched ore — feeds the Phase 5 detail box.
// Pure: looks up the deposit (by name + signature) in the table and returns its
// cluster + material quality breakdown, optionally scoped to a location's spawn
// and occurrence probabilities.

import type { QualityMaterial, SignatureTable } from './types';

export interface QualityDetail {
  ore: string;
  signature: number;
  clusterMin: number;
  clusterMax: number;
  /** Overall cluster probability (0..1), if known. */
  clusterProbability?: number;
  /** Selected-location specifics, when a location is given and found. */
  location?: {
    name: string;
    system: string;
    type?: string;
    /** group_probability (0..1). */
    spawn?: number;
    /** relative_probability (0..1). */
    occurrence?: number;
  };
  /** Material composition + quality rows. */
  materials: QualityMaterial[];
}

/**
 * Detail for the matched ore (by name + signature), optionally scoped to a
 * location. Returns null when the deposit isn't in the table.
 */
export function getQualityDetail(
  table: SignatureTable,
  oreName: string,
  signature: number,
  locationName?: string | null,
): QualityDetail | null {
  const deposit = table.deposits.find((d) => d.name === oreName && d.signature === signature);
  if (!deposit) return null;

  let location: QualityDetail['location'];
  if (locationName) {
    const loc = deposit.locations.find((l) => l.name === locationName);
    if (loc) {
      location = {
        name: loc.name,
        system: loc.system,
        type: loc.type,
        spawn: loc.probability,
        occurrence: loc.occurrence,
      };
    }
  }

  return {
    ore: deposit.name,
    signature: deposit.signature,
    clusterMin: deposit.clustering.minSize,
    clusterMax: deposit.clustering.maxSize,
    clusterProbability: deposit.clustering.probability,
    location,
    materials: deposit.materials ?? [],
  };
}
