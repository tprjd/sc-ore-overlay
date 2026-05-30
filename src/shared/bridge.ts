// Types shared across the Electron/preload boundary. Pure types only — no
// `electron` or DOM imports — so both the Node (main/preload) and browser
// (renderer) TypeScript projects can reference it without leaking globals.

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
}

/** What the control window pushes to the overlay. */
export interface OverlayPayload {
  /** The accepted RS reading, or null when none is stable. */
  reading: number | null;
  /** Ranked candidates (best first); empty = no match. */
  candidates: OverlayCandidate[];
}

/** Commands raised by global hotkeys in the main process. */
export type OverlayCommand = 'pause' | 'recalibrate';

/** The typed, sandboxed API exposed to the renderer as `window.sco`. */
export interface ScoBridge {
  /** Enumerate capturable screens and windows (control window). */
  getCaptureSources(): Promise<CaptureSource[]>;
  /** Liveness check confirming the preload bridge is wired up. */
  ping(): string;
  /** Control → overlay (relayed by main): push the latest matches. */
  sendMatches(payload: OverlayPayload): void;
  /** Overlay: receive pushed matches. Returns an unsubscribe fn. */
  onMatches(cb: (payload: OverlayPayload) => void): () => void;
  /** Control: receive hotkey commands from main. Returns an unsubscribe fn. */
  onCommand(cb: (command: OverlayCommand) => void): () => void;
  /** Overlay: receive edit-mode toggles from main. Returns an unsubscribe fn. */
  onEditMode(cb: (editing: boolean) => void): () => void;
}
