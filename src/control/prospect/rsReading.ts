// Pure transition for the RS reading state machine: reading → held → expired,
// with a low-confidence gate. Extracted from the old ScanView capture effect so
// it can be unit-tested frame-by-frame. The Voter is the one controlled
// side-effect (push/reset mutate it); everything else is derived from inputs, so
// a test drives this with the real createVoter and asserts each tick.

import type { Voter } from '../../core';
import { isExpired } from '../../core';

/** Why the overlay shows (or doesn't) what it does, from the read pipeline. */
export type ReadState = 'reading' | 'held' | 'expired' | 'low-conf' | 'no-rs';

export interface ReadingState {
  /** The latched, temporally-voted reading shown on the overlay (or null). */
  stableRs: number | null;
  /** Voter is confirming a *different* value than the one shown (may change). */
  settling: boolean;
  readState: ReadState;
  /** performance.now() of the last valid reading; null when none/expired. */
  lastValidAt: number | null;
  /** Whether any valid reading has ever been seen (expired vs never-read). */
  hadReading: boolean;
}

export const INITIAL_READING_STATE: ReadingState = {
  stableRs: null,
  settling: false,
  readState: 'no-rs',
  lastValidAt: null,
  hadReading: false,
};

export interface ReadingInput {
  /** This tick's RS reading (null = nothing readable / gated out upstream). */
  reading: number | null;
  /** This tick's best OCR confidence (0..1), or null when there was no OCR. */
  ocrScore: number | null;
  /** performance.now() for this tick. */
  now: number;
  /** Minimum confidence to treat a read as real (reads below arrive as null). */
  minConf: number;
  /** How long to keep the last value after reads stop, before dropping it. */
  holdMs: number;
}

/**
 * Advance the reading state by one capture tick. `voter` is pushed on a valid
 * read and reset when the hold window elapses — the only mutation.
 */
export function nextReadingState(
  prev: ReadingState,
  input: ReadingInput,
  voter: Voter,
): ReadingState {
  const { reading, ocrScore, now, minConf, holdMs } = input;
  // A read below the confidence gate arrives as null (gated upstream); detect
  // the low-conf case so we can say *why* nothing showed.
  const lowConf = ocrScore != null && ocrScore < minConf;

  if (reading != null) {
    const stable = voter.push(reading);
    return {
      stableRs: stable,
      settling: voter.candidate != null && voter.candidate !== stable,
      readState: 'reading',
      lastValidAt: now,
      hadReading: true,
    };
  }

  if (!isExpired(prev.lastValidAt, now, holdMs)) {
    // No fresh read but within the hold window: keep the last value on screen.
    const shown = voter.stable;
    return {
      ...prev,
      readState: shown != null ? 'held' : lowConf ? 'low-conf' : 'no-rs',
    };
  }

  // Hold elapsed: drop the latched value so the overlay clears.
  voter.reset();
  return {
    stableRs: null,
    settling: false,
    readState: lowConf ? 'low-conf' : prev.hadReading ? 'expired' : 'no-rs',
    lastValidAt: null,
    hadReading: prev.hadReading,
  };
}

/**
 * Update a rolling timestamp window and return the measured tick rate (Hz). Pure
 * given the array (which it mutates in place, capped at `cap` samples) — used by
 * the store to show capture cadence in the status bar.
 */
export function tickRateOf(times: number[], now: number, cap = 8): number {
  times.push(now);
  if (times.length > cap) times.shift();
  return times.length >= 2 ? (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000) : 0;
}
