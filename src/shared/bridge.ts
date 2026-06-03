// Types shared across the Electron/preload boundary. Pure types only — no
// `electron` or DOM imports — so both the Node (main/preload) and browser
// (renderer) TypeScript projects can reference it without leaking globals.

import type { QualityDetail } from '../core/quality';
import type { ScanResult } from '../core/scan';
import type { SurveyEntry } from '../core/survey';

/** A screen or window the user can capture, as enumerated by desktopCapturer. */
export interface CaptureSource {
  /** desktopCapturer id, e.g. "screen:0:0" or "window:12345:0". */
  id: string;
  /** Human-facing name, e.g. "Star Citizen" or "Screen 1". */
  name: string;
  /** PNG data URL preview thumbnail. */
  thumbnailDataUrl: string;
  /** Whether this is a whole screen or a single window. */
  type: 'screen' | 'window';
}

/** One ore candidate as shown on the overlay. */
export interface OverlayCandidate {
  name: string;
  nodes: number;
  score: number;
  /** Non-ore noise (wreck/sat/debris) signature subtracted; null/undefined = direct match. */
  noise?: number | null;
  /** Match accepted only after relaxing the table's cluster-size range. */
  loose?: boolean;
}

/** Compact OCR stats for the RS region, shown on the overlay when enabled. */
export interface OverlayOcr {
  /** Best detected-line confidence (0..1). */
  score: number;
  /** recognize() wall time in ms. */
  ms: number;
  /** Detected text-line count. */
  lineCount: number;
}

/** What the control window pushes to the overlay (relayed to both boxes). */
export interface OverlayPayload {
  /** The accepted RS reading, or null when none is stable. */
  reading: number | null;
  /** Ranked candidates (best first); empty = no match. */
  candidates: OverlayCandidate[];
  /** Quality detail for the top candidate (for the detail box); null = none. */
  detail?: QualityDetail | null;
  /** The scanned rock's SCAN RESULTS reading (for the scan overlay); null = none. */
  scan?: ScanResult | null;
  /**
   * True while the temporal voter is confirming a *new* reading that differs
   * from the one currently shown — i.e. the displayed value may be about to
   * change. The overlay renders this as a pulsing (vs solid) confidence dot.
   */
  settling?: boolean;
  /** OCR stats for the RS region (for the overlay's optional stats line). */
  ocr?: OverlayOcr | null;
}

/** Commands raised by global hotkeys in the main process. */
export type OverlayCommand = 'pause' | 'recalibrate';

/** Overlay text-size preset. */
export type OverlayScale = 'compact' | 'normal' | 'large';

/** Scanned-rock composition sort column. */
export type ScanSort = 'scu' | 'quality' | 'percent';

/** Sort direction. */
export type SortDir = 'asc' | 'desc';

/** Live-tunable overlay appearance. */
export interface OverlayConfig {
  /** Idle fade-out delay in ms; 0 = never fade. */
  idleMs: number;
  scale: OverlayScale;
  /** CSS font-family for the overlay text. */
  fontFamily: string;
  /** Card background color (hex, e.g. "#0d0f12"). */
  bgColor: string;
  /** Card background opacity, 0..1. */
  bgOpacity: number;
  /** Card inner padding in px. */
  padding: number;
  /** Vertical gap between lines in px. */
  gap: number;
  /** Show the card border. */
  border: boolean;
  /** Show the "scanning…" / "no match" placeholder when there are no candidates. */
  showPlaceholder: boolean;
  /** Show the second "ore detail" overlay box. */
  showDetail: boolean;
  /** Show the "scanned rock" overlay box (SCU-per-quality from the scan). */
  showScan: boolean;
  /** Show an OCR stats line (confidence · latency · lines) on the overlay card. */
  showOcrStats: boolean;
  /** Scanned-rock card sort column (SCU / quality / percent). */
  scanSort: ScanSort;
  /** Scanned-rock card sort direction. */
  scanSortDir: SortDir;
}

/** Default overlay appearance. */
export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  idleMs: 10_000,
  scale: 'normal',
  fontFamily: 'system-ui, sans-serif',
  bgColor: '#0d0f12',
  bgOpacity: 0.55,
  padding: 10,
  gap: 4,
  border: true,
  showPlaceholder: true,
  showDetail: false,
  showScan: false,
  showOcrStats: false,
  scanSort: 'scu',
  scanSortDir: 'desc',
};

/** A rebindable global-hotkey action. */
export type HotkeyAction = 'toggleOverlay' | 'pause' | 'recalibrate' | 'editOverlay';

/** Electron accelerator string per action, e.g. { pause: "Alt+Shift+P" }. */
export type HotkeyMap = Record<HotkeyAction, string>;

/** Default global hotkeys (Electron accelerators). */
export const DEFAULT_HOTKEYS: HotkeyMap = {
  toggleOverlay: 'Alt+Shift+O',
  pause: 'Alt+Shift+P',
  recalibrate: 'Alt+Shift+R',
  editOverlay: 'Alt+Shift+E',
};

/** A persisted region (structurally identical to the renderer's NormRegion). */
export interface PersistedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a Survey-Mode capture region reads (see SURVEY-MODE.md). */
export type SurveyRole = 'rs' | 'shipPos' | 'system' | 'scanResult';

/** One persisted Survey-Mode capture region + the field it reads. */
export interface SurveyRegionSetting {
  id: string;
  role: SurveyRole;
  rect: PersistedRegion;
  enabled: boolean;
  /** Per-region upscale override; falls back to the global upscale when unset. */
  scale?: number;
}

/** User settings persisted to Electron userData (survive restart). */
export interface AppSettings {
  sourceId?: string;
  sourceName?: string;
  region?: PersistedRegion | null;
  location?: string | null;
  scale?: number;
  intervalMs?: number;
  quorum?: number;
  activePatch?: string;
  hotkeys?: Partial<HotkeyMap>;
  overlay?: Partial<OverlayConfig>;
  overlayBounds?: { x: number; y: number; width: number; height: number };
  detailBounds?: { x: number; y: number; width: number; height: number };
  scanBounds?: { x: number; y: number; width: number; height: number };
  /** Mining tab: persisted capture regions (RS + scan-result) + their roles. */
  mining?: {
    regions?: SurveyRegionSetting[];
    /**
     * Known non-ore signatures to try subtracting from the RS before matching
     * — wrecks, satellites, debris panels that sometimes sit on top of an ore
     * reading. Defaults to []. Edit in the Mining → "Noise signatures" panel.
     */
    noiseSignatures?: number[];
    /**
     * Enforce the table's cluster-size range when matching. Default true.
     * Turn off when the table is stale for the current patch and clean-divisor
     * hits outside the stated range should be accepted.
     */
    enforceCluster?: boolean;
  };
  /** Survey Mode: persisted capture regions + their roles, and the scout name. */
  survey?: { regions?: SurveyRegionSetting[]; scout?: string };
  /** True once the first-run setup wizard has been completed or skipped. */
  setupComplete?: boolean;
  /**
   * Feature flags. `survey` gates the Survey tab — off by default so the
   * default UI is just Mining. Flip via settings.json (or the DevTools console:
   * `window.sco.setSettings({ features: { survey: true } })`) and relaunch.
   */
  features?: { survey?: boolean };
}

/** The typed, sandboxed API exposed to the renderer as `window.sco`. */
export interface ScoBridge {
  /** Enumerate capturable screens and windows (control window). */
  getCaptureSources(): Promise<CaptureSource[]>;
  /** Liveness check confirming the preload bridge is wired up. */
  ping(): string;
  /** Load persisted settings (control window). */
  getSettings(): Promise<AppSettings>;
  /** Merge + persist settings to Electron userData (control window). */
  setSettings(patch: Partial<AppSettings>): void;
  /** Re-register the global hotkeys and persist them. Returns ok-per-action. */
  setHotkeys(map: HotkeyMap): Promise<Record<HotkeyAction, boolean>>;
  /** Control → overlay (relayed by main): push the latest matches. */
  sendMatches(payload: OverlayPayload): void;
  /** Overlay: receive pushed matches. Returns an unsubscribe fn. */
  onMatches(cb: (payload: OverlayPayload) => void): () => void;
  /** Control: receive hotkey commands from main. Returns an unsubscribe fn. */
  onCommand(cb: (command: OverlayCommand) => void): () => void;
  /** Overlay: receive edit-mode toggles from main. Returns an unsubscribe fn. */
  onEditMode(cb: (editing: boolean) => void): () => void;
  /** Control → overlay (relayed by main): live appearance config (persisted). */
  setOverlayConfig(config: OverlayConfig): void;
  /** Overlay: receive appearance config. Returns an unsubscribe fn. */
  onOverlayConfig(cb: (config: OverlayConfig) => void): () => void;
  /** Overlay → main: resize the overlay window to the given content size. */
  resizeOverlay(size: { width: number; height: number }): void;
  /** Overlay: receive a visibility toggle from a hotkey. Returns an unsubscribe fn. */
  onToggleVisible(cb: () => void): () => void;
  /** Detail box → main: resize the detail window to the given content size. */
  resizeDetail(size: { width: number; height: number }): void;
  /** Scan box → main: resize the scanned-rock window to the given content size. */
  resizeScan(size: { width: number; height: number }): void;
  /** Survey Mode: load the persisted scan log (separate file from settings). */
  getSurveyLog(): Promise<SurveyEntry[]>;
  /** Survey Mode: persist the full scan log (append-only, managed in renderer). */
  saveSurveyLog(entries: SurveyEntry[]): void;
}
