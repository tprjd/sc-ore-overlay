import { describe, expect, it } from 'vitest';
import {
  deriveHealth,
  deriveOverlayStatus,
  type HealthInput,
  type OverlayStatusInput,
} from '../src/control/prospect/status';

const statusInput = (over: Partial<OverlayStatusInput>): OverlayStatusInput => ({
  sourceLost: false,
  paused: false,
  readState: 'no-rs',
  stableRs: null,
  matchCount: 0,
  hasScanRegion: false,
  hasFrozenScan: false,
  rawRs: null,
  ...over,
});

describe('deriveOverlayStatus', () => {
  it('source-lost wins over everything', () => {
    expect(
      deriveOverlayStatus(
        statusInput({ sourceLost: true, paused: true, stableRs: 100, matchCount: 1 }),
      ),
    ).toBe('source-lost');
  });
  it('paused beats a live match', () => {
    expect(deriveOverlayStatus(statusInput({ paused: true, stableRs: 100, matchCount: 1 }))).toBe(
      'paused',
    );
  });
  it('held is reported before deriving from stableRs', () => {
    expect(
      deriveOverlayStatus(statusInput({ readState: 'held', stableRs: 100, matchCount: 1 })),
    ).toBe('held');
  });
  it('ok when a reading matches an ore', () => {
    expect(deriveOverlayStatus(statusInput({ stableRs: 21350, matchCount: 2 }))).toBe('ok');
  });
  it('no-match when a reading divides into nothing', () => {
    expect(deriveOverlayStatus(statusInput({ stableRs: 99, matchCount: 0 }))).toBe('no-match');
  });
  it('low-conf when reads are gated below threshold', () => {
    expect(deriveOverlayStatus(statusInput({ readState: 'low-conf' }))).toBe('low-conf');
  });
  it('expired when the hold window elapsed', () => {
    expect(deriveOverlayStatus(statusInput({ readState: 'expired' }))).toBe('expired');
  });
  it('no-scan when a scan region is set but no panel parsed and no RS', () => {
    expect(
      deriveOverlayStatus(statusInput({ hasScanRegion: true, hasFrozenScan: false, rawRs: null })),
    ).toBe('no-scan');
  });
  it('no-rs is the fallback', () => {
    expect(deriveOverlayStatus(statusInput({}))).toBe('no-rs');
  });
});

const healthInput = (over: Partial<HealthInput>): HealthInput => ({
  sourceLost: false,
  paused: false,
  hasRsRegion: true,
  capturing: true,
  confPct: 95,
  ...over,
});

describe('deriveHealth', () => {
  it('source lost', () => {
    expect(deriveHealth(healthInput({ sourceLost: true })).label).toBe('source lost');
  });
  it('paused', () => {
    expect(deriveHealth(healthInput({ paused: true })).label).toBe('paused');
  });
  it('prompts to add an RS region', () => {
    expect(deriveHealth(healthInput({ hasRsRegion: false })).label).toBe('add RS region');
  });
  it('starting when not yet capturing', () => {
    expect(deriveHealth(healthInput({ capturing: false })).label).toBe('starting…');
  });
  it('no reading when capturing but no confidence', () => {
    expect(deriveHealth(healthInput({ confPct: null })).label).toBe('no reading');
  });
  it('ready at high confidence', () => {
    expect(deriveHealth(healthInput({ confPct: 95 })).label).toBe('ready');
  });
  it('low conf in the middle band', () => {
    expect(deriveHealth(healthInput({ confPct: 75 })).label).toBe('low conf');
  });
  it('poor conf at the bottom', () => {
    expect(deriveHealth(healthInput({ confPct: 40 })).label).toBe('poor conf');
  });
});
