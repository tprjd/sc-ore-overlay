import { describe, expect, it } from 'vitest';

import { bestReading, parseReading } from '../src/core/parse';

describe('parseReading', () => {
  it('parses a clean digit string', () => {
    expect(parseReading('21350')).toBe(21350);
  });

  it('strips whitespace and joins split digit groups', () => {
    expect(parseReading('  21 350 \n')).toBe(21350);
    expect(parseReading('21\n350')).toBe(21350);
  });

  it('drops stray non-digit characters (commas, letters)', () => {
    expect(parseReading('1,350')).toBe(1350);
    expect(parseReading('RS: 4270')).toBe(4270);
  });

  it('handles leading zeros', () => {
    expect(parseReading('007')).toBe(7);
  });

  it('returns null when there are no digits', () => {
    expect(parseReading('')).toBeNull();
    expect(parseReading('----')).toBeNull();
    expect(parseReading('  \n ')).toBeNull();
  });
});

describe('bestReading', () => {
  it('reads a clean single detection', () => {
    expect(bestReading([{ text: '17,080', score: 0.99 }])).toBe(17080);
  });

  it('picks the longest digit token (isolates a number from stray glyphs)', () => {
    // A crop bisecting the pin icon yields "9 17,080" on one line.
    expect(bestReading([{ text: '9 17,080', score: 0.83 }])).toBe(17080);
  });

  it('picks the digit line among multiple detections', () => {
    expect(
      bestReading([
        { text: 'STRONG', score: 0.9 },
        { text: '21350', score: 0.95 },
      ]),
    ).toBe(21350);
  });

  it('breaks ties on equal length by confidence', () => {
    expect(
      bestReading([
        { text: '12', score: 0.4 },
        { text: '34', score: 0.9 },
      ]),
    ).toBe(34);
  });

  it('returns null when no token has a digit', () => {
    expect(bestReading([{ text: 'SCAN' }, { text: '---' }])).toBeNull();
    expect(bestReading([])).toBeNull();
  });
});
