import { describe, expect, it } from 'vitest';
import type { VoteState } from '../src/core/validator';
import {
  createVoter,
  initialVoteState,
  isExpired,
  isPlausibleReading,
  voteStep,
} from '../src/core/validator';

describe('isExpired', () => {
  it('is fresh within the hold window', () => {
    expect(isExpired(1000, 1000 + 3000, 4000)).toBe(false);
  });
  it('expires once past the hold window', () => {
    expect(isExpired(1000, 1000 + 4001, 4000)).toBe(true);
  });
  it('is not expired exactly at the boundary', () => {
    expect(isExpired(1000, 1000 + 4000, 4000)).toBe(false);
  });
  it('never expires when holdMs <= 0 (sticky)', () => {
    expect(isExpired(1000, 1000 + 999999, 0)).toBe(false);
    expect(isExpired(1000, 1000 + 999999, -1)).toBe(false);
  });
  it('is not expired when there was never a valid read', () => {
    expect(isExpired(null, 99999, 4000)).toBe(false);
  });
});

describe('isPlausibleReading', () => {
  it('accepts a positive integer in range', () => {
    expect(isPlausibleReading(21350)).toBe(true);
    expect(isPlausibleReading(1)).toBe(true);
  });

  it('rejects null, non-integers, and non-finite values', () => {
    expect(isPlausibleReading(null)).toBe(false);
    expect(isPlausibleReading(undefined)).toBe(false);
    expect(isPlausibleReading(3.5)).toBe(false);
    expect(isPlausibleReading(Number.NaN)).toBe(false);
    expect(isPlausibleReading(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejects values outside the bounds (default and custom)', () => {
    expect(isPlausibleReading(0)).toBe(false); // default min 1
    expect(isPlausibleReading(-10)).toBe(false);
    expect(isPlausibleReading(99_999_999)).toBe(false); // default max 10M
    expect(isPlausibleReading(500, { min: 1000 })).toBe(false);
    expect(isPlausibleReading(5000, { max: 4000 })).toBe(false);
    expect(isPlausibleReading(1500, { min: 1000, max: 2000 })).toBe(true);
  });
});

describe('voteStep (windowed majority)', () => {
  const q3 = { quorum: 3 }; // window defaults to quorum + 1 = 4

  it('latches once a value reaches quorum within the window', () => {
    let s: VoteState = initialVoteState;
    expect(voteStep(s, 4270, q3).stable).toBeNull(); // 1 of 3
    s = voteStep(s, 4270, q3).state;
    expect(voteStep(s, 4270, q3).stable).toBeNull(); // 2 of 3
    s = voteStep(s, 4270, q3).state;
    const r = voteStep(s, 4270, q3); // 3 of 3 → accepted
    expect(r.stable).toBe(4270);
  });

  it('tolerates a stray frame during the initial lock', () => {
    let s: VoteState = initialVoteState;
    s = voteStep(s, 7, q3).state;
    s = voteStep(s, 7, q3).state;
    s = voteStep(s, 999, q3).state; // a single OCR misread
    const r = voteStep(s, 7, q3); // window [7,7,999,7] → 7 wins 3/4
    expect(r.stable).toBe(7);
  });

  it('keeps the latched value through a stray frame (no flicker to null)', () => {
    let s: VoteState = initialVoteState;
    for (const v of [7, 7, 7]) s = voteStep(s, v, q3).state; // latched 7
    const stray = voteStep(s, 12345, q3); // window [7,7,7,12345] → 7 still 3/4
    expect(stray.stable).toBe(7);
  });

  it('flips to a new value only once it wins the window', () => {
    let s: VoteState = initialVoteState;
    for (const v of [7, 7, 7]) s = voteStep(s, v, q3).state; // latched 7
    let r = voteStep(s, 9, q3); // [7,7,7,9] → 7
    expect(r.stable).toBe(7);
    s = r.state;
    r = voteStep(s, 9, q3); // [7,7,9,9] tie → stays 7 (sticky)
    expect(r.stable).toBe(7);
    s = r.state;
    r = voteStep(s, 9, q3); // [7,9,9,9] → 9 wins
    expect(r.stable).toBe(9);
  });

  it('ignores dropped/garbage frames (null) so the stable reading persists', () => {
    let s: VoteState = initialVoteState;
    for (const v of [5, 5, 5]) s = voteStep(s, v, q3).state; // latched 5
    const dropped = voteStep(s, null, q3);
    expect(dropped.stable).toBe(5); // still latched
    expect(dropped.state).toEqual(s); // window unchanged
  });

  it('accepts immediately when quorum is 1', () => {
    expect(voteStep(initialVoteState, 123, { quorum: 1 }).stable).toBe(123);
  });
});

describe('createVoter (windowed majority)', () => {
  it('latches a stable value after the quorum and reset clears', () => {
    const voter = createVoter({ quorum: 2 }); // window 3
    expect(voter.push(4270)).toBeNull();
    expect(voter.push(4270)).toBe(4270);
    expect(voter.stable).toBe(4270);

    voter.reset();
    expect(voter.stable).toBeNull();
    expect(voter.candidate).toBeNull();
    expect(voter.count).toBe(0);
  });

  it('does not drop the latched value on a single stray reading', () => {
    const voter = createVoter({ quorum: 2 }); // window 3
    voter.push(100);
    expect(voter.push(100)).toBe(100); // locked
    // One stray plausible value no longer unseats the latch — 100 still leads
    // the window — which is what fixes the never-locks-then-runs-away loop.
    expect(voter.push(200)).toBe(100);
    expect(voter.stable).toBe(100);
    // A sustained new value (wins the window) does flip it.
    expect(voter.push(200)).toBe(200);

    // A dropped (null) frame keeps the latched value — not a reset.
    expect(voter.push(null)).toBe(200);
    expect(voter.candidate).toBe(200);
  });

  it('exposes the window leader as candidate + count', () => {
    const voter = createVoter({ quorum: 3 }); // window 4
    voter.push(4270);
    expect(voter.candidate).toBe(4270);
    expect(voter.count).toBe(1);
    expect(voter.stable).toBeNull();

    voter.push(4270);
    expect(voter.count).toBe(2);
    expect(voter.stable).toBeNull();
  });
});
