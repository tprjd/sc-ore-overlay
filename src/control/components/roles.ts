// Shared region-role metadata + helpers, used by the Survey and Mining region
// pickers (RegionList) and their capture previews.

import type { SurveyRole } from '../../shared/bridge';
import type { NormRegion } from '../preprocess';

export const ROLE_META: Record<SurveyRole, { label: string; color: string }> = {
  scanResult: { label: 'Scan Result', color: '#f0abfc' },
  shipPos: { label: 'Ship Pos', color: '#6ee7b7' },
  rs: { label: 'RS', color: '#4fd1ff' },
  system: { label: 'System', color: '#fbbf24' },
};

/** Default box for a freshly added region (center-ish), drawn over afterwards. */
export const DEFAULT_RECT: NormRegion = { x: 0.4, y: 0.45, w: 0.2, h: 0.06 };

export function newRegionId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}
