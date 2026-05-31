// Survey Mode core: the data model for a scanned-rock log and the pure helpers
// the map and (later) the network sync build on. Framework-free and testable —
// no Electron / DOM, no randomness (ids and timestamps are supplied by callers
// so these stay pure). See SURVEY-MODE.md for the plan.

import type { Vec3 } from './coords';
import type { OreCandidate } from './types';
import type { QualityDetail } from './quality';

/** Whether a logged entry was created here or arrived from a peer (sync, later). */
export type EntrySource = 'local' | 'peer';

/** A scout's role in an op — the main mining vessel or a forward scout. */
export type ScoutRole = 'main' | 'scout';

/** Which two world axes form the top-down map plane; the third is depth. */
export type AxisPlane = 'xy' | 'xz' | 'yz';

/** One scanned rock, logged at the ship's position when it was scanned. */
export interface SurveyEntry {
  /** Stable id; the dedupe/merge key across the network. */
  id: string;
  /** Epoch ms when logged. */
  ts: number;
  /** Who logged it (callsign). */
  scout: string;
  /** System the reading belongs to, e.g. "NyxSolarSystem" (scopes the map). */
  system: string;
  /** Ship position at scan time (meters, absolute SolarSystem frame). */
  pos: Vec3;
  /** Radar signature reading. */
  rs: number;
  /** Ranked ore candidates from `matchOre`. */
  candidates: OreCandidate[];
  /** Primary ore (top candidate, or a later user pick). */
  ore?: string;
  /** Node count for the primary ore. */
  nodes?: number;
  /** Quality breakdown when the location is known (from `getQualityDetail`). */
  quality?: QualityDetail;
  /** Free-text note. */
  notes?: string;
  /** Where the entry came from. */
  source: EntrySource;
}

/** Live position of a connected scout (presence; not persisted). Sync, later. */
export interface ScoutPresence {
  scout: string;
  role: ScoutRole;
  system: string;
  pos: Vec3;
  /** Last update (epoch ms); stale markers fade. */
  ts: number;
}

/** A position projected onto the map plane, relative to the map center. */
export interface PlanarPoint {
  /** Horizontal offset on the plane (meters). */
  x: number;
  /** Vertical offset on the plane (meters). */
  y: number;
  /** Out-of-plane (depth) offset (meters). */
  depth: number;
}

/** Fields needed to build a `SurveyEntry`; ore/nodes are derived from candidates. */
export interface NewEntryInput {
  id: string;
  ts: number;
  scout: string;
  system: string;
  pos: Vec3;
  rs: number;
  candidates: OreCandidate[];
  quality?: QualityDetail;
  notes?: string;
  source?: EntrySource;
}

/**
 * Assemble a `SurveyEntry`, deriving the primary ore + node count from the
 * top-ranked candidate. Pure: the caller supplies `id` and `ts`.
 */
export function makeEntry(input: NewEntryInput): SurveyEntry {
  const top = input.candidates[0];
  return {
    id: input.id,
    ts: input.ts,
    scout: input.scout,
    system: input.system,
    pos: input.pos,
    rs: input.rs,
    candidates: input.candidates,
    ore: top?.name,
    nodes: top?.nodes,
    quality: input.quality,
    notes: input.notes,
    source: input.source ?? 'local',
  };
}

/** Euclidean distance between two positions (meters). */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Project a world position onto the top-down map plane, relative to `center`
 * (the ship). Returns plane offsets `x`/`y` plus the out-of-plane `depth`, all
 * in meters. Default plane is X/Y with Z as depth.
 */
export function project(pos: Vec3, center: Vec3, plane: AxisPlane = 'xy'): PlanarPoint {
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const dz = pos.z - center.z;
  switch (plane) {
    case 'xz':
      return { x: dx, y: dz, depth: dy };
    case 'yz':
      return { x: dy, y: dz, depth: dx };
    case 'xy':
    default:
      return { x: dx, y: dy, depth: dz };
  }
}

/** De-duplicate entries by id, keeping the first occurrence. */
export function dedupeEntries(entries: SurveyEntry[]): SurveyEntry[] {
  const byId = new Map<string, SurveyEntry>();
  for (const e of entries) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

/**
 * Merge incoming entries into existing ones, de-duplicating by id and keeping
 * the entry already held (append-only; same id ⇒ same rock). This is the seam
 * the network sync will write through later.
 */
export function mergeEntries(existing: SurveyEntry[], incoming: SurveyEntry[]): SurveyEntry[] {
  const byId = new Map<string, SurveyEntry>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

/** Keep only entries belonging to a given system. */
export function filterBySystem(entries: SurveyEntry[], system: string): SurveyEntry[] {
  return entries.filter((e) => e.system === system);
}
