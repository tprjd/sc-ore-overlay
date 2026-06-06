// Types shared across the Electron/preload boundary. Pure types only — no
// `electron` or DOM imports — so both the Node (main/preload) and browser
// (renderer) TypeScript projects can reference it without leaking globals.

import type { CrawlProgress } from '../core/crawl';
import type { QualityDetail } from '../core/quality';
import type { ScanResult } from '../core/scan';
import type { SurveyEntry } from '../core/survey';
import type { SignatureTable } from '../core/types';

export type { CrawlProgress } from '../core/crawl';

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

/** One OCR-detected text line and its mean confidence (0..1). Shared so the
 *  preload bridge can type the native (utility-process) OCR transport. */
export interface OcrLine {
  text: string;
  score: number;
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

/**
 * Why the overlay is showing what it's showing — so a blank overlay (or the
 * control window) can explain *why* nothing matched, instead of failing
 * silently. Threaded from the read pipeline to both the control UI and the
 * overlay so the reason isn't re-derived in two places.
 * - `ok`          — a real match is shown.
 * - `no-match`    — a valid reading, but no ore divides it.
 * - `held`        — the read dropped; the last ore is shown on borrowed time (within holdMs).
 * - `expired`     — holdMs elapsed; the stale reading was cleared (this is why it's empty).
 * - `low-conf`    — reads arriving but below the confidence gate (rejected garbage).
 * - `no-rs`       — nothing readable in the RS region.
 * - `no-scan`     — RS fine, but no SCAN RESULTS panel detected (empty scan box).
 * - `source-lost` — the capture source is gone; the overlay hides entirely.
 * - `paused`      — capture paused by the user.
 * - `inactive`    — no source picked / the Mining view isn't live; the overlay hides entirely.
 */
export type OverlayStatus =
  | 'ok'
  | 'no-match'
  | 'held'
  | 'expired'
  | 'low-conf'
  | 'no-rs'
  | 'no-scan'
  | 'source-lost'
  | 'paused'
  | 'inactive';

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
  /** Why the overlay shows (or doesn't show) what it does. See OverlayStatus. */
  status?: OverlayStatus;
}

/** Result of an app-version check against GitHub Releases (see electron/update.ts). */
export interface UpdateInfo {
  /** The running app version (from package.json). */
  current: string;
  /** Latest published release tag (e.g. "v1.3.0"), or null if none/unreachable. */
  latest: string | null;
  /** Release page to open for a manual download. */
  url: string;
  /** True when `latest` is newer than `current`. */
  available: boolean;
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
  /** Idle fade-out delay in ms; 0 = never fade. Fades *opacity* only. */
  idleMs: number;
  /**
   * How long to keep showing the last reading after fresh reads stop (the RS
   * chip left the screen), in ms; 0 = never drop (sticky forever, legacy). Once
   * elapsed the *value* is cleared (status → `expired`), distinct from `idleMs`
   * which only fades the opacity while the value persists underneath.
   */
  holdMs: number;
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
  /**
   * Auto-fit each overlay window's height to its card content (default true). When
   * off, the window keeps a fixed height and the edit-mode grip resizes height too.
   */
  autoResize: boolean;
  /** Scanned-rock card sort column (SCU / quality / percent). */
  scanSort: ScanSort;
  /** Scanned-rock card sort direction. */
  scanSortDir: SortDir;
}

/** Default overlay appearance. */
export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  idleMs: 10_000,
  holdMs: 4_000,
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
  autoResize: true,
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
  /**
   * Minimum OCR confidence (0..1) to accept a reading. Reads below this are
   * treated as no-reading (fed to the voter as null), not as a candidate, so
   * clear garbage can't move the lock. PP-OCR scores run high; default ~0.5.
   */
  minConfidence?: number;
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
   * Latest release tag the user dismissed in the update banner. The banner stays
   * hidden for this version, then reappears when a newer tag ships.
   */
  dismissedUpdate?: string;
  /**
   * OCR execution backend.
   * - 'wasm' (CPU, default): never touches the GPU, so it can't be starved by
   *   the overlay window's compositor. Slowest (~1–2 s/fresh read).
   * - 'directml': native onnxruntime-node in a utility process, DirectML EP —
   *   GPU OCR on any DX12 GPU (NVIDIA/AMD/Intel). Its own D3D12 device sits
   *   outside Chromium's GPU process, so it does NOT contend with the overlay
   *   the way in-renderer WebGPU does. ~28 ms/read once warm. Falls back to
   *   'wasm' if the host can't start or DirectML init fails. (See TASKS.md R4.)
   * - 'webgpu': in-renderer ONNX-Runtime-Web WebGPU. Faster than wasm but
   *   fights the visible overlay for the GPU on some setups (latency spikes
   *   into the seconds); kept for the adventurous, not the default.
   * Set via settings.json / DevTools and relaunch.
   */
  ocrBackend?: 'wasm' | 'webgpu' | 'directml';
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
  /**
   * Factory reset: delete the persisted settings file and relaunch the app to a
   * clean first-run state. The survey scan log (separate file) is left intact.
   */
  resetSettings(): void;
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
  /**
   * Probe whether the native (utility-process) DirectML OCR host is up. Spawns
   * it on first call and resolves true once DirectML/CPU init succeeds, false if
   * the host can't start or the EP fails — the renderer then falls back to WASM.
   */
  ocrAvailable(): Promise<boolean>;
  /** Run OCR on a PNG data-URL crop via the native host. Rejects if it's down. */
  ocrRecognize(dataUrl: string): Promise<OcrLine[]>;
  /** Survey Mode: load the persisted scan log (separate file from settings). */
  getSurveyLog(): Promise<SurveyEntry[]>;
  /** Survey Mode: persist the full scan log (append-only, managed in renderer). */
  saveSurveyLog(entries: SurveyEntry[]): void;
  /**
   * Load the crawled signature tables from userData (may be empty). The renderer
   * merges these over its bundled fallback, preferring a crawled table per patch.
   */
  getCrawledTables(): Promise<SignatureTable[]>;
  /**
   * Startup sync: tell main the newest patch the renderer already has (bundled +
   * crawled). Main crawls only if the live game patch is newer; same patch is a
   * no-op. Results arrive via onCrawlProgress / onTablesUpdated.
   */
  syncTables(newestHave: string | null): void;
  /**
   * Force a re-crawl of the current game patch now. Resolves with the new table
   * (also broadcast via onTablesUpdated), or null on failure. Never throws.
   */
  refreshTables(): Promise<SignatureTable | null>;
  /** Control: a crawl finished and new tables are on disk. Returns an unsubscribe fn. */
  onTablesUpdated(cb: () => void): () => void;
  /** Control: progress from an in-flight crawl (startup or manual). Unsubscribe fn. */
  onCrawlProgress(cb: (p: CrawlProgress) => void): () => void;
  /** Check GitHub Releases for a newer version (startup + manual). Never throws. */
  checkForUpdates(): Promise<UpdateInfo>;
  /** Open an external https URL in the user's browser (e.g. a release page). */
  openExternal(url: string): void;
  /** The running app version (package.json) — for the About panel. */
  appVersion(): Promise<string>;
  /** Open the folder holding main.log in the OS file manager (bug reports). */
  openLogs(): void;
}
