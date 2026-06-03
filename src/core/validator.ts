// The validator — pure functions that turn noisy per-frame OCR output into a
// stable reading. Two independent concerns:
//
//   1. Plausibility: is a single parsed value structurally sane?
//   2. Temporal voting: has the same value held across N consecutive frames?
//
// Compose them in the capture loop:
//
//     const next = voteStep(state, isPlausibleReading(raw) ? raw : null, { quorum });
//
// Keeping these pure (a reducer, not a class) makes the flicker-killing logic
// trivially testable.

/** Bounds for a structurally plausible RS reading. */
export interface PlausibilityOptions {
  /** Smallest acceptable value (inclusive). Default 1. */
  min?: number;
  /** Largest acceptable value (inclusive). Default 10,000,000. */
  max?: number;
}

/**
 * Is `value` a structurally plausible RS reading? It must be a finite positive
 * integer within `[min, max]`. This is deliberately about the *number*, not
 * whether any ore matches it (that's the matcher's job).
 */
export function isPlausibleReading(
  value: number | null | undefined,
  opts: PlausibilityOptions = {},
): value is number {
  if (value == null || !Number.isFinite(value) || !Number.isInteger(value)) {
    return false;
  }
  const min = opts.min ?? 1;
  const max = opts.max ?? 10_000_000;
  return value >= min && value <= max;
}

/** Options for the temporal voter. */
export interface VoteOptions {
  /** Consecutive identical frames required before a value is accepted. */
  quorum: number;
}

/** Internal voter state — carry this between frames. */
export interface VoteState {
  /** The value currently being counted, or null after a reset. */
  candidate: number | null;
  /** How many consecutive frames `candidate` has held. */
  count: number;
}

/** Result of one voting step. */
export interface VoteResult {
  /** Carry this into the next `voteStep` call. */
  state: VoteState;
  /**
   * The accepted, stable reading — non-null once the streak reaches the quorum,
   * and it stays latched until a *different* value reaches quorum. Dropped or
   * garbage frames (null) are ignored, not treated as a reset.
   */
  stable: number | null;
}

/** Fresh voter state. */
export const initialVoteState: VoteState = { candidate: null, count: 0 };

/**
 * Advance the temporal voter by one frame.
 *
 * - A `null` reading (implausible / no match / dropped frame) is ignored — the
 *   state and stable output are unchanged.
 * - A reading equal to the current candidate extends the streak.
 * - A different reading starts a new streak at count 1.
 * - `stable` is the candidate once its streak reaches `quorum`, else null.
 */
export function voteStep(
  state: VoteState,
  reading: number | null,
  opts: VoteOptions,
): VoteResult {
  const quorum = Math.max(1, Math.floor(opts.quorum));

  if (reading == null) {
    // Ignore a dropped/garbage frame: keep state so one miss doesn't break a
    // stable reading (the overlay's idle-fade handles a value truly leaving).
    return { state, stable: state.count >= quorum ? state.candidate : null };
  }

  const count = reading === state.candidate ? state.count + 1 : 1;
  const next: VoteState = { candidate: reading, count };
  const stable = count >= quorum ? reading : null;
  return { state: next, stable };
}

/** Imperative wrapper around `voteStep` for the capture loop. */
export interface Voter {
  /** Feed one frame; returns the current stable reading (or null). */
  push(reading: number | null): number | null;
  /** The current stable reading without advancing. */
  readonly stable: number | null;
  /** The value currently accumulating votes (may differ from `stable`). */
  readonly candidate: number | null;
  /** How many consecutive frames `candidate` has held. */
  readonly count: number;
  /** Clear all state. */
  reset(): void;
}

/** Create a stateful voter that wraps the pure `voteStep` reducer. */
export function createVoter(opts: VoteOptions): Voter {
  let state = initialVoteState;
  let stable: number | null = null;
  return {
    push(reading) {
      const result = voteStep(state, reading, opts);
      state = result.state;
      stable = result.stable;
      return stable;
    },
    get stable() {
      return stable;
    },
    get candidate() {
      return state.candidate;
    },
    get count() {
      return state.count;
    },
    reset() {
      state = initialVoteState;
      stable = null;
    },
  };
}
