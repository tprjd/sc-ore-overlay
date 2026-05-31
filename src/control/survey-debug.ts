// Synthetic survey data for building and tuning the map before real logging
// (S3) exists. A fixed ship position (realistic SolarSystem-scale coordinates)
// plus a deterministic scatter of fake scanned rocks around it. Gated behind the
// "Debug values" toggle in the Survey tab — never used in real logging.

import { makeEntry } from '../core';
import type { SurveyEntry, Vec3 } from '../core';

/** A plausible absolute ship position (meters), matching the sample HUD. */
export const DEBUG_SHIP: Vec3 = { x: -14_215_974_612, y: -4_787_767_810, z: 735 };

const ORES: Array<{ name: string; signature: number }> = [
  { name: 'Quantanium', signature: 5923 },
  { name: 'Bexalite', signature: 4360 },
  { name: 'Iron', signature: 4270 },
  { name: 'Tungsten', signature: 3400 },
  { name: 'Quartz', signature: 3170 },
  { name: 'Aluminum', signature: 3050 },
  { name: 'Titanium', signature: 2890 },
  { name: 'Copper', signature: 2790 },
];

/** Small deterministic PRNG so the field is stable across re-renders. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic field of fake survey entries scattered (denser near
 * the center) within ~14 km of the debug ship, with a little vertical spread.
 */
export function debugEntries(count = 28, seed = 7): SurveyEntry[] {
  const rng = mulberry32(seed);
  const out: SurveyEntry[] = [];
  for (let i = 0; i < count; i++) {
    const ore = ORES[Math.floor(rng() * ORES.length)];
    const nodes = 1 + Math.floor(rng() * 8);
    const angle = rng() * Math.PI * 2;
    const radius = Math.pow(rng(), 0.6) * 14_000; // denser toward the ship
    const pos: Vec3 = {
      x: DEBUG_SHIP.x + Math.cos(angle) * radius,
      y: DEBUG_SHIP.y + Math.sin(angle) * radius,
      z: DEBUG_SHIP.z + (rng() - 0.5) * 4_000,
    };
    out.push(
      makeEntry({
        id: `dbg-${i}`,
        ts: Date.now() - Math.floor(rng() * 3_600_000),
        scout: rng() < 0.5 ? 'Falcon' : 'Vireo',
        system: 'NyxSolarSystem',
        pos,
        rs: ore.signature * nodes,
        candidates: [{ name: ore.name, nodes, score: 0.5 + rng() * 0.5, signature: ore.signature }],
        source: 'local',
      }),
    );
  }
  return out;
}
