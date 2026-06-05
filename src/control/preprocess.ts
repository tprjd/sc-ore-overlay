// Renderer-only: crop a normalized region from the capture source and upscale
// it to a PNG for PP-OCR. PP-OCR reads raw color text robustly and localizes
// the digits within the crop, so there is NO binarization / threshold tuning —
// we just crop and (optionally) enlarge a small region so detection has more to
// work with.

/** Anything we can draw to a canvas as a capture frame. */
export type DrawableSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

/** A region of interest in normalized 0..1 coordinates (resolution-independent). */
export interface NormRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop tuning. */
export interface PreprocessParams {
  /** Integer upscale factor (small regions detect better enlarged). */
  scale: number;
}

export interface PreprocessResult {
  /** Canvas holding the (color) crop. */
  canvas: HTMLCanvasElement;
  /** PNG data URL of the crop — handed to PP-OCR and shown in the debug view. */
  dataUrl: string;
  /** Raw RGBA pixels of the crop, for cheap unchanged-frame detection. */
  pixels: { data: Uint8ClampedArray; width: number; height: number };
  /** Intrinsic source dimensions the crop was taken from. */
  sourceWidth: number;
  sourceHeight: number;
}

function intrinsicSize(src: DrawableSource): { width: number; height: number } {
  if (src instanceof HTMLVideoElement) {
    return { width: src.videoWidth, height: src.videoHeight };
  }
  if (src instanceof HTMLImageElement) {
    return { width: src.naturalWidth, height: src.naturalHeight };
  }
  return { width: src.width, height: src.height };
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Produce an upscaled color crop of `region` from `src`. Returns null when the
 * source isn't ready (zero intrinsic size) or has no 2D context.
 */
export function preprocess(
  src: DrawableSource,
  region: NormRegion,
  params: PreprocessParams,
): PreprocessResult | null {
  const { width: sw, height: sh } = intrinsicSize(src);
  if (sw < 1 || sh < 1) return null;

  const sx = clamp(Math.round(region.x * sw), 0, sw - 1);
  const sy = clamp(Math.round(region.y * sh), 0, sh - 1);
  const cw = clamp(Math.round(region.w * sw), 1, sw - sx);
  const ch = clamp(Math.round(region.h * sh), 1, sh - sy);

  // Upscale for legibility, but cap the longest side: OCR detection time grows
  // with pixel count, and a high per-region upscale on a wide region otherwise
  // produces a huge, very slow input for little accuracy gain.
  const scale = Math.max(1, Math.round(params.scale));
  let dw = Math.max(1, cw * scale);
  let dh = Math.max(1, ch * scale);
  const MAX_SIDE = 1600;
  const longest = Math.max(dw, dh);
  if (longest > MAX_SIDE) {
    const f = MAX_SIDE / longest;
    dw = Math.max(1, Math.round(dw * f));
    dh = Math.max(1, Math.round(dh * f));
  }

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, cw, ch, 0, 0, dw, dh);

  const frame = ctx.getImageData(0, 0, dw, dh);
  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    pixels: { data: frame.data, width: dw, height: dh },
    sourceWidth: sw,
    sourceHeight: sh,
  };
}
