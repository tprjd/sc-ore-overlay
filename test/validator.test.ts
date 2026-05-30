import { describe, it, expect } from 'vitest';

import {
  isPlausibleReading,
  voteStep,
  createVoter,
  initialVoteState,
} from '../src/core/validator';
import type { VoteState } from '../src/core/validator';

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

describe('voteStep', () => {
  const quorum3 = { quorum: 3 };

  it('accepts a value only after the quorum of consecutive frames', () => {
    let s: VoteState = initialVoteState;

    let r = voteStep(s, 4270, quorum3);
    expect(r.stable).toBeNull(); // count 1
    s = r.state;

    r = voteStep(s, 4270, quorum3);
    expect(r.stable).toBeNull(); // count 2
    s = r.state;

    r = voteStep(s, 4270, quorum3);
    expect(r.stable).toBe(4270); // count 3 → accepted
    s = r.state;

    r = voteStep(s, 4270, quorum3);
    expect(r.stable).toBe(4270); // still stable past quorum
  });

  it('resets the streak when a different reading arrives', () => {
    let s: VoteState = initialVoteState;
    for (const v of [42, 42, 42]) s = voteStep(s, v, quorum3).state;
    expect(voteStep(s, 42, quorum3).stable).toBe(42);

    // A different reading drops the stable output immediately (reset)...
    const reset = voteStep(s, 99, quorum3);
    expect(reset.stable).toBeNull();
    expect(reset.state).toEqual({ candidate: 99, count: 1 });

    // ...and the new value must earn its own quorum.
    s = reset.state;
    s = voteStep(s, 99, quorum3).state;
    expect(voteStep(s, 99, quorum3).stable).toBe(99);
  });

  it('treats a dropped frame (null) as a reset', () => {
    let s: VoteState = initialVoteState;
    for (const v of [7, 7, 7]) s = voteStep(s, v, quorum3).state;
    expect(voteStep(s, 7, quorum3).stable).toBe(7);

    const dropped = voteStep(s, null, quorum3);
    expect(dropped.stable).toBeNull();
    expect(dropped.state).toEqual({ candidate: null, count: 0 });
  });

  it('accepts immediately when quorum is 1', () => {
    const r = voteStep(initialVoteState, 123, { quorum: 1 });
    expect(r.stable).toBe(123);
  });
});

describe('createVoter', () => {
  it('latches a stable value after the quorum and resets on change', () => {
    const voter = createVoter({ quorum: 2 });
    expect(voter.push(4270)).toBeNull();
    expect(voter.push(4270)).toBe(4270);
    expect(voter.stable).toBe(4270);

    expect(voter.push(8540)).toBeNull(); // reset to new candidate
    expect(voter.push(8540)).toBe(8540);

    voter.reset();
    expect(voter.stable).toBeNull();
  });
});
