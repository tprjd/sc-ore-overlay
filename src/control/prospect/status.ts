// Pure status/health derivations for the prospect (scan→identify) pipeline,
// extracted from ScanView so they're unit-testable. Colors are raw hex (used
// inline for status dots/labels, not Tailwind classes — they're data, not style).

import type { OverlayStatus } from '../../shared/bridge';
import type { ReadState } from './rsReading';

export interface OverlayStatusInput {
  sourceLost: boolean;
  paused: boolean;
  readState: ReadState;
  stableRs: number | null;
  matchCount: number;
  /** A SCAN RESULTS region is enabled (so a missing panel is worth reporting). */
  hasScanRegion: boolean;
  /** A frozen scan is currently held. */
  hasFrozenScan: boolean;
  /** This tick's raw RS reading (pre-vote), null when nothing readable. */
  rawRs: number | null;
}

/**
 * Single source of truth for *why* the overlay shows what it shows. Mirrors the
 * priority ladder the old ScanView inlined: lost/paused/held first, then a real
 * match, then the various "nothing" reasons.
 */
export function deriveOverlayStatus(i: OverlayStatusInput): OverlayStatus {
  if (i.sourceLost) return 'source-lost';
  if (i.paused) return 'paused';
  if (i.readState === 'held') return 'held';
  if (i.stableRs != null) return i.matchCount > 0 ? 'ok' : 'no-match';
  if (i.readState === 'low-conf') return 'low-conf';
  if (i.readState === 'expired') return 'expired';
  if (i.hasScanRegion && !i.hasFrozenScan && i.rawRs == null) return 'no-scan';
  return 'no-rs';
}

/** Footer label + color per overlay status (the `settling` sub-state is layered on by the caller). */
export const STATUS_META: Record<OverlayStatus, { label: string; color: string }> = {
  ok: { label: 'locked', color: '#6ee7b7' },
  'no-match': { label: 'no match', color: '#fbbf24' },
  held: { label: 'held', color: '#fbbf24' },
  expired: { label: 'expired', color: '#f87171' },
  'low-conf': { label: 'low conf', color: '#f87171' },
  'no-scan': { label: 'no scan panel', color: '#fbbf24' },
  'no-rs': { label: 'no RS', color: '#9fb3c8' },
  'source-lost': { label: 'source lost', color: '#f87171' },
  paused: { label: 'paused', color: '#9fb3c8' },
  // deriveOverlayStatus never emits this (the mining view isn't live then); it
  // exists only to keep this map total over OverlayStatus.
  inactive: { label: 'inactive', color: '#9fb3c8' },
};

export interface Health {
  color: string;
  label: string;
}

export interface HealthInput {
  sourceLost: boolean;
  paused: boolean;
  hasRsRegion: boolean;
  /** Frames are flowing (not paused/lost and tick rate > 0). */
  capturing: boolean;
  /** Best OCR confidence as a percent (0..100), or null when no reading. */
  confPct: number | null;
}

/** Header health pill — one-glance pipeline rollup, colored by the worst stage. */
export function deriveHealth(i: HealthInput): Health {
  if (i.sourceLost) return { color: '#f87171', label: 'source lost' };
  if (i.paused) return { color: '#9fb3c8', label: 'paused' };
  if (!i.hasRsRegion) return { color: '#f87171', label: 'add RS region' };
  if (!i.capturing) return { color: '#fbbf24', label: 'starting…' };
  if (i.confPct == null) return { color: '#fbbf24', label: 'no reading' };
  if (i.confPct >= 90) return { color: '#6ee7b7', label: 'ready' };
  if (i.confPct >= 70) return { color: '#fbbf24', label: 'low conf' };
  return { color: '#f87171', label: 'poor conf' };
}
