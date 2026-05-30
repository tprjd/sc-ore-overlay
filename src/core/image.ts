// Pure pixel operations for OCR preprocessing. No DOM — these work on a plain
// `{ data, width, height }` buffer (structurally an ImageData) so they can be
// unit-tested in Node. The DOM glue (crop + upscale via canvas) lives in the
// renderer (`src/control/preprocess.ts`) and calls into these.

/** A raw RGBA pixel buffer — structurally compatible with `ImageData`. */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Rec. 601 luma weights — how bright a pixel reads to the eye. */
export function luminance(r: number, g: number, b: number): number {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

/** Options for {@link binarize}. */
export interface BinarizeParams {
  /** Brightness cutoff (0..255): a text pixel must be at least this luminous. */
  threshold: number;
  /**
   * Max chroma (max−min channel, 0..255) for a pixel to count as text. The RS
   * number is always white (near-zero chroma), so this rejects a colored
   * background regardless of its brightness — robust to the chip color changing.
   * Set to 255 to disable the chroma gate (pure luminance threshold).
   */
  chromaTol: number;
  /** Output dark-on-light (true) for OCR: white HUD text becomes black glyphs. */
  invert: boolean;
}

/**
 * Isolate the white HUD text into a clean black/white image for OCR. A pixel is
 * "text" when it is bright (luminance ≥ threshold) AND achromatic (chroma ≤
 * chromaTol). Keying on whiteness — not just brightness — means a colored
 * background of any brightness is rejected. Returns a new buffer; the input is
 * not mutated. Output pixels are fully opaque, all channels 0 or 255.
 */
export function binarize(src: PixelBuffer, params: BinarizeParams): PixelBuffer {
  const { data, width, height } = src;
  const out = new Uint8ClampedArray(data.length);
  const on = params.invert ? 0 : 255; // a "text" pixel
  const off = params.invert ? 255 : 0; // a "background" pixel
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const isText = luminance(r, g, b) >= params.threshold && chroma <= params.chromaTol;
    const v = isText ? on : off;
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

/**
 * Cheap rolling hash of a pixel buffer (FNV-1a over every `step`-th byte), used
 * to skip OCR when the cropped region hasn't changed between frames. Default
 * step samples one channel per pixel.
 */
export function hashPixels(buf: PixelBuffer, step = 4): number {
  const { data } = buf;
  const s = Math.max(1, Math.floor(step));
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += s) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
