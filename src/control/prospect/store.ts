// Zustand store for the prospect (scan → identify) runtime pipeline. Holds only
// per-tick runtime state — settings stay App-owned/persisted. Components select
// narrow slices so a per-tick pushReadout only re-renders what changed. The
// voting/hold/expire and scan-freeze logic live here (the transition itself is
// the pure nextReadingState); the voter + accumulators are non-reactive
// internals (prefixed `_`, never selected).

import { create } from 'zustand';
import type { ScanResult, Voter } from '../../core';
import { createVoter, isExpired, snapMaterial } from '../../core';
import type { ReadingState } from './rsReading';
import { INITIAL_READING_STATE, nextReadingState, tickRateOf } from './rsReading';

/**
 * Two scans are "the same rock" when the OCR'd ore matches and the rock's
 * fingerprint (composition row count + mass) is close. Used to freeze the scan
 * box against OCR jitter while the rock stays targeted.
 */
function sameRock(a: ScanResult, b: ScanResult): boolean {
  if (a.ore.toLowerCase() !== b.ore.toLowerCase()) return false;
  if (a.composition.length !== b.composition.length) return false;
  if (Math.abs((a.mass ?? 0) - (b.mass ?? 0)) > 200) return false;
  return true;
}

interface ProspectState extends ReadingState {
  /** Measured capture cadence (Hz) for the status bar. */
  tickRate: number;
  sourceLost: boolean;
  paused: boolean;
  /** The frozen SCAN RESULTS rock (held against OCR jitter), or null. */
  frozenScan: ScanResult | null;

  // Config snapshot (set by the orchestrator from params/overlayConfig).
  quorum: number;
  minConf: number;
  holdMs: number;

  // Non-reactive internals — never selected, so mutating them doesn't re-render.
  _voter: Voter;
  _tickTimes: number[];
  _lastScanAt: number | null;

  // Actions
  configure: (cfg: { quorum: number; minConf: number; holdMs: number }) => void;
  pushReadout: (rs: number | null, ocrScore: number | null, now: number) => void;
  pushScan: (scan: ScanResult | null, oreVocab: string[], now: number) => void;
  setSourceLost: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  togglePause: () => void;
  recalibrate: () => void;
  reset: () => void;
}

const DEFAULTS = { quorum: 3, minConf: 0.5, holdMs: 4000 };

export const useProspectStore = create<ProspectState>()((set, get) => ({
  ...INITIAL_READING_STATE,
  tickRate: 0,
  sourceLost: false,
  paused: false,
  frozenScan: null,
  ...DEFAULTS,
  _voter: createVoter({ quorum: DEFAULTS.quorum }),
  _tickTimes: [],
  _lastScanAt: null,

  configure: ({ quorum, minConf, holdMs }) => {
    const s = get();
    // The voter is stateful — recreate it only when the quorum actually changes.
    if (quorum !== s.quorum) set({ _voter: createVoter({ quorum }) });
    set({ quorum, minConf, holdMs });
  },

  pushReadout: (rs, ocrScore, now) => {
    const s = get();
    const next = nextReadingState(
      {
        stableRs: s.stableRs,
        settling: s.settling,
        readState: s.readState,
        lastValidAt: s.lastValidAt,
        hadReading: s.hadReading,
      },
      { reading: rs, ocrScore, now, minConf: s.minConf, holdMs: s.holdMs },
      s._voter,
    );
    set({ ...next, tickRate: tickRateOf(s._tickTimes, now) });
  },

  pushScan: (scan, oreVocab, now) => {
    const s = get();
    if (!scan) {
      // No panel parsed: clear once the hold window elapses so stale composition
      // doesn't linger after the rock's gone.
      if (s.frozenScan && isExpired(s._lastScanAt, now, s.holdMs)) {
        set({ frozenScan: null, _lastScanAt: null });
      }
      return;
    }
    // Snap material names to the table vocabulary at freeze time so consumers see
    // clean names without their own fuzzy matching.
    const snapped: ScanResult = {
      ...scan,
      ore: snapMaterial(scan.ore, oreVocab),
      composition: scan.composition.map((c) => ({
        ...c,
        material: snapMaterial(c.material, oreVocab),
      })),
    };
    set({ _lastScanAt: now });
    // Replace the frozen scan only when the OCR clearly reports a different rock.
    if (s.frozenScan && sameRock(s.frozenScan, snapped)) return;
    set({ frozenScan: snapped });
  },

  setSourceLost: (v) => set({ sourceLost: v }),
  setPaused: (v) => set(v ? { paused: true, _tickTimes: [], tickRate: 0 } : { paused: false }),
  togglePause: () => get().setPaused(!get().paused),
  recalibrate: () => set({ frozenScan: null }),

  reset: () =>
    set({
      ...INITIAL_READING_STATE,
      tickRate: 0,
      sourceLost: false,
      paused: false,
      frozenScan: null,
      _voter: createVoter({ quorum: get().quorum }),
      _tickTimes: [],
      _lastScanAt: null,
    }),
}));
