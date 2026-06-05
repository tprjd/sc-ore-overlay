import { describe, expect, it } from 'vitest';
import type { PixelBuffer } from '../src/core/image';
import { binarize, hashPixels, luminance } from '../src/core/image';

/** Build a buffer from a list of [r,g,b] pixels (alpha forced to 255). */
function buf(pixels: Array<[number, number, number]>): PixelBuffer {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return { data, width: pixels.length, height: 1 };
}

// chromaTol 255 disables the chroma gate → pure luminance threshold.
const LUMA = { chromaTol: 255 } as const;

describe('luminance', () => {
  it('weights green most and is monotonic', () => {
    expect(luminance(255, 255, 255)).toBeCloseTo(255, 5);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
  });
});

describe('binarize', () => {
  it('thresholds bright pixels to white and dark pixels to black', () => {
    const out = binarize(
      buf([
        [255, 255, 255],
        [0, 0, 0],
        [200, 200, 200],
        [50, 50, 50],
      ]),
      {
        threshold: 128,
        ...LUMA,
        invert: false,
      },
    );
    expect([out.data[0], out.data[4], out.data[8], out.data[12]]).toEqual([255, 0, 255, 0]);
    expect(out.data[3]).toBe(255); // alpha opaque
  });

  it('inverts when requested (white HUD text → black glyphs for OCR)', () => {
    const normal = binarize(
      buf([
        [255, 255, 255],
        [0, 0, 0],
      ]),
      { threshold: 128, ...LUMA, invert: false },
    );
    const inverted = binarize(
      buf([
        [255, 255, 255],
        [0, 0, 0],
      ]),
      { threshold: 128, ...LUMA, invert: true },
    );
    expect(normal.data[0]).toBe(255);
    expect(inverted.data[0]).toBe(0);
    expect(inverted.data[4]).toBe(255);
  });

  it('rejects colored pixels even when bright (white-text keying)', () => {
    // white = text; bright orange (high chroma) = background despite being luminous;
    // mid gray (zero chroma) = text.
    const out = binarize(
      buf([
        [255, 255, 255],
        [255, 140, 40],
        [180, 180, 180],
      ]),
      {
        threshold: 120,
        chromaTol: 70,
        invert: false,
      },
    );
    expect(luminance(255, 140, 40)).toBeGreaterThan(120); // orange IS bright enough...
    expect([out.data[0], out.data[4], out.data[8]]).toEqual([255, 0, 255]); // ...but excluded by chroma
  });

  it('does not mutate the source buffer', () => {
    const src = buf([[255, 255, 255]]);
    const copy = Uint8ClampedArray.from(src.data);
    binarize(src, { threshold: 10, chromaTol: 255, invert: true });
    expect(src.data).toEqual(copy);
  });
});

describe('hashPixels', () => {
  it('is deterministic for identical buffers', () => {
    const a = buf([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const b = buf([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(hashPixels(a, 1)).toBe(hashPixels(b, 1));
  });

  it('changes when a sampled byte changes', () => {
    const a = buf([
      [10, 20, 30],
      [40, 50, 60],
    ]);
    const b = buf([
      [10, 20, 30],
      [99, 50, 60],
    ]);
    expect(hashPixels(a, 1)).not.toBe(hashPixels(b, 1));
  });
});
