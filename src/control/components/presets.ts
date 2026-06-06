// One-click overlay presets, shared by the setup wizard (Options step) and the
// Mining panel's Overlay tab. Each patches only scale + what shows (boxes/stats/
// border), leaving the user's appearance fine-tuning (color, opacity, padding,
// gap, fade, font) untouched.

import type { OverlayConfig } from '../../shared/bridge';
import type { LoopParams } from '../useCaptureLoop';

export type OverlayPreset = 'minimal' | 'standard' | 'detailed';

export const OVERLAY_PRESETS: Array<{
  id: OverlayPreset;
  label: string;
  hint: string;
  patch: Partial<OverlayConfig>;
}> = [
  {
    id: 'minimal',
    label: 'Minimal',
    hint: 'Just the ore name and node count.',
    patch: {
      scale: 'compact',
      border: false,
      showPlaceholder: false,
      showDetail: false,
      showScan: false,
      showOcrStats: false,
    },
  },
  {
    id: 'standard',
    label: 'Standard',
    hint: 'Ore + nodes with a subtle card and a live status line when empty.',
    patch: {
      scale: 'normal',
      border: true,
      showPlaceholder: true,
      showDetail: false,
      showScan: false,
      showOcrStats: false,
    },
  },
  {
    id: 'detailed',
    label: 'Detailed',
    hint: 'Adds the ore-quality and scanned-rock boxes + OCR stats.',
    patch: {
      scale: 'normal',
      border: true,
      showPlaceholder: true,
      showDetail: true,
      showScan: true,
      showOcrStats: true,
    },
  },
];

/** Which preset (if any) the current config matches — for highlighting. */
export function matchPreset(config: OverlayConfig): OverlayPreset | null {
  return (
    OVERLAY_PRESETS.find(({ patch }) =>
      Object.entries(patch).every(([k, v]) => config[k as keyof OverlayConfig] === v),
    )?.id ?? null
  );
}

// ---------------------------------------------------------------------------
// Capture-speed presets — how often a frame is sampled (intervalMs) and how many
// identical reads the voter needs before a value locks (quorum). Faster = more
// responsive but jumpier + heavier; slower = steadier + lighter but laggier.
// Shared by the setup wizard (Capture step) and the Mining panel's Capture tab.
// ---------------------------------------------------------------------------
export type CapturePreset = 'fast' | 'normal' | 'slow';

export type CaptureParams = Pick<LoopParams, 'intervalMs' | 'quorum'>;

export const CAPTURE_PRESETS: Array<{
  id: CapturePreset;
  label: string;
  hint: string;
  patch: CaptureParams;
}> = [
  {
    id: 'fast',
    label: 'Fast',
    hint: 'Snappiest updates, but jumpier on a noisy RS and a bit more CPU.',
    patch: { intervalMs: 300, quorum: 2 },
  },
  {
    id: 'normal',
    label: 'Normal',
    hint: 'Balanced responsiveness and stability. Recommended.',
    patch: { intervalMs: 700, quorum: 3 },
  },
  {
    id: 'slow',
    label: 'Slow',
    hint: 'Steadiest and lightest on CPU; updates a beat slower.',
    patch: { intervalMs: 1000, quorum: 4 },
  },
];

/** "300 ms · 2 frames" — the concrete values behind a capture preset/params. */
export function captureValuesLabel(p: CaptureParams): string {
  return `${p.intervalMs} ms · ${p.quorum} frame${p.quorum === 1 ? '' : 's'}`;
}

/** Which capture preset (if any) the current params match — for highlighting. */
export function matchCapturePreset(params: CaptureParams): CapturePreset | null {
  return (
    CAPTURE_PRESETS.find(
      ({ patch }) => params.intervalMs === patch.intervalMs && params.quorum === patch.quorum,
    )?.id ?? null
  );
}
