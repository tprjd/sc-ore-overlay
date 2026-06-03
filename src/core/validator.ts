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
  /** Agreeing frames *within the window* required before a value is accepted. */
  quorum: number;
  /**
   * Sliding-window size. Defaults to `quorum + 1`, i.e. tolerate one stray
   * frame: a value latches on `quorum` of the last `quorum + 1` readings, so a
   * single OCR misread no longer blocks the lock or unseats a stable value.
   */
  windowSize?: number;
}

/** Internal voter state — carry this between frames. */
export interface VoteState {
  /** The last `windowSize` plausible readings (most recent last). */
  window: number[];
  /** Latched stable reading — sticky until a *different* value reaches quorum. */
  stable: number | null;
}

/** Result of one voting step. */
export interface VoteResult {
  /** Carry this into the next `voteStep` call. */
  state: VoteState;
  /**
   * The accepted, stable reading — non-null once some value reaches the quorum
   * within the window, and it stays latched (sticky) until a *different* value
   * reaches quorum. Dropped/garbage frames (null) are ignored, not a reset.
   */
  stable: number | null;
}

/** Fresh voter state. */
export const initialVoteState: VoteState = { window: [], stable: null };

function resolveWindow(opts: VoteOptions): { quorum: number; windowSize: number } {
  const quorum = Math.max(1, Math.floor(opts.quorum));
  const windowSize = Math.max(quorum, Math.floor(opts.windowSize ?? quorum + 1));
  return { quorum, windowSize };
}

/**
 * The most frequent value in the window and its count. Ties break toward the
 * most-recent reading, so a genuine transition resolves promptly once it gains
 * a plurality, while sporadic flicker (no plurality) can't unseat the latch.
 */
function leaderOf(window: number[]): { value: number | null; count: number } {
  if (window.length === 0) return { value: null, count: 0 };
  const counts = new Map<number, number>();
  for (const v of window) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = window[window.length - 1];
  let bestCount = counts.get(best) ?? 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return { value: best, count: bestCount };
}

/**
 * Advance the temporal voter by one frame (windowed majority).
 *
 * - A `null` reading (implausible / no match / dropped frame) is ignored — the
 *   window and stable output are unchanged.
 * - Otherwise the reading joins a sliding window of the last `windowSize`
 *   readings. The window's most-frequent value latches as `stable` once its
 *   count reaches `quorum`; until then the previous latch is kept (sticky), so
 *   a stray frame neither blocks the initial lock nor flickers it to null.
 */
export function voteStep(
  state: VoteState,
  reading: number | null,
  opts: VoteOptions,
): VoteResult {
  const { quorum, windowSize } = resolveWindow(opts);

  if (reading == null) {
    return { state, stable: state.stable };
  }

  const window = [...state.window, reading].slice(-windowSize);
  const { value, count } = leaderOf(window);
  const stable = value != null && count >= quorum ? value : state.stable;
  return { state: { window, stable }, stable };
}

/** Imperative wrapper around `voteStep` for the capture loop. */
export interface Voter {
  /** Feed one frame; returns the current stable reading (or null). */
  push(reading: number | null): number | null;
  /** The current stable reading without advancing. */
  readonly stable: number | null;
  /** The window's current leading value (may differ from `stable`). */
  readonly candidate: number | null;
  /** How many of the windowed frames the leading value holds. */
  readonly count: number;
  /** Clear all state. */
  reset(): void;
}

/** Create a stateful voter that wraps the pure `voteStep` reducer. */
export function createVoter(opts: VoteOptions): Voter {
  let state = initialVoteState;
  return {
    push(reading) {
      const result = voteStep(state, reading, opts);
      state = result.state;
      return result.stable;
    },
    get stable() {
      return state.stable;
    },
    get candidate() {
      return leaderOf(state.window).value;
    },
    get count() {
      return leaderOf(state.window).count;
    },
    reset() {
      state = initialVoteState;
    },
  };
}
