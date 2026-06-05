// One-click overlay presets, shared by the setup wizard (Options step) and the
// Mining panel's Overlay tab. Each patches only scale + what shows (boxes/stats/
// border), leaving the user's appearance fine-tuning (color, opacity, padding,
// gap, fade, font) untouched.

import type { OverlayConfig } from '../../shared/bridge';

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
    hint: 'Ore + nodes with a subtle card and “scanning” hint.',
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
