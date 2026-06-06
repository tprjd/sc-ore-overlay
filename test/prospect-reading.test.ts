import { describe, expect, it } from 'vitest';
import {
  INITIAL_READING_STATE,
  nextReadingState,
  type ReadingInput,
  tickRateOf,
} from '../src/control/prospect/rsReading';
import { createVoter } from '../src/core';

const input = (over: Partial<ReadingInput>): ReadingInput => ({
  reading: null,
  ocrScore: null,
  now: 0,
  minConf: 0.5,
  holdMs: 4000,
  ...over,
});

describe('nextReadingState', () => {
  it('locks a clean read (quorum 1)', () => {
    const v = createVoter({ quorum: 1 });
    const s = nextReadingState(INITIAL_READING_STATE, input({ reading: 21350, now: 1000 }), v);
    expect(s.stableRs).toBe(21350);
    expect(s.readState).toBe('reading');
    expect(s.lastValidAt).toBe(1000);
    expect(s.hadReading).toBe(true);
    expect(s.settling).toBe(false);
  });

  it('holds the last value when reads stop within holdMs', () => {
    const v = createVoter({ quorum: 1 });
    let s = nextReadingState(INITIAL_READING_STATE, input({ reading: 4270, now: 1000 }), v);
    s = nextReadingState(s, input({ reading: null, now: 2000 }), v); // +1s, hold 4s
    expect(s.readState).toBe('held');
    expect(s.stableRs).toBe(4270); // unchanged while held
    expect(s.lastValidAt).toBe(1000); // not refreshed
  });

  it('expires and drops the value once holdMs elapses', () => {
    const v = createVoter({ quorum: 1 });
    let s = nextReadingState(INITIAL_READING_STATE, input({ reading: 4270, now: 1000 }), v);
    s = nextReadingState(s, input({ reading: null, now: 1000 + 4001 }), v);
    expect(s.readState).toBe('expired');
    expect(s.stableRs).toBeNull();
    expect(s.lastValidAt).toBeNull();
  });

  it('stays no-rs when nothing has ever read', () => {
    const v = createVoter({ quorum: 1 });
    const s = nextReadingState(INITIAL_READING_STATE, input({ reading: null, now: 5000 }), v);
    expect(s.readState).toBe('no-rs');
    expect(s.stableRs).toBeNull();
  });

  it('reports low-conf when a sub-threshold read is gated out', () => {
    const v = createVoter({ quorum: 1 });
    const s = nextReadingState(
      INITIAL_READING_STATE,
      input({ reading: null, ocrScore: 0.3, now: 100 }),
      v,
    );
    expect(s.readState).toBe('low-conf');
  });

  it('settles while the voter accumulates a new value (quorum 3)', () => {
    const v = createVoter({ quorum: 3 });
    let s = nextReadingState(INITIAL_READING_STATE, input({ reading: 100, now: 1 }), v);
    expect(s.stableRs).toBeNull(); // not yet at quorum
    expect(s.settling).toBe(true); // candidate 100 ≠ stable null
    s = nextReadingState(s, input({ reading: 100, now: 2 }), v);
    s = nextReadingState(s, input({ reading: 100, now: 3 }), v);
    expect(s.stableRs).toBe(100);
    expect(s.settling).toBe(false);
  });
});

describe('tickRateOf', () => {
  it('is 0 with a single sample', () => {
    expect(tickRateOf([], 1000)).toBe(0);
  });
  it('measures ~Hz over the window', () => {
    const t: number[] = [];
    tickRateOf(t, 0);
    tickRateOf(t, 1000);
    expect(tickRateOf(t, 2000)).toBeCloseTo(1, 5); // 2 intervals / 2s = 1 Hz
  });
  it('caps the rolling window', () => {
    const t: number[] = [];
    for (let i = 0; i <= 20; i++) tickRateOf(t, i * 100);
    expect(t.length).toBeLessThanOrEqual(8);
  });
});
