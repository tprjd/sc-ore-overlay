// Window management: the control window, a hidden owner (so the overlay boxes are
// owned tool windows excluded from Alt+Tab), and the three transparent
// click-through boxes (overlay/detail/scan), which share one factory. Owns the
// window refs + the edit-mode toggle; accessors let ipc/hotkeys reach the windows.

import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { AppSettings } from '../src/shared/bridge';
import { APP_ICON, DEV_SERVER_URL, PRELOAD, RENDERER_DIST } from './env';
import { readSettings, writeSettings } from './settings';

type Page = 'index' | 'overlay' | 'detail' | 'scan';
type BoundsKey = 'overlayBounds' | 'detailBounds' | 'scanBounds';

let controlWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let detailWin: BrowserWindow | null = null;
let scanWin: BrowserWindow | null = null;
let ownerWin: BrowserWindow | null = null;
let editing = false;

export const controlWindow = (): BrowserWindow | null => controlWin;
export const overlayBox = (): BrowserWindow | null => overlayWin;
export const detailBox = (): BrowserWindow | null => detailWin;
export const scanBox = (): BrowserWindow | null => scanWin;

/** The transparent boxes (overlay + detail + scan) that currently exist. */
export const overlayBoxWindows = (): BrowserWindow[] =>
  [overlayWin, detailWin, scanWin].filter((w): w is BrowserWindow => w !== null);

function loadPage(win: BrowserWindow, page: Page): void {
  if (DEV_SERVER_URL) {
    const url = page === 'index' ? DEV_SERVER_URL : new URL(`${page}.html`, DEV_SERVER_URL).href;
    void win.loadURL(url);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, `${page}.html`));
  }
}

interface BoxDefaults {
  width: number;
  height: number;
  x: number;
  y: number;
  minWidth: number;
  minHeight: number;
}

/**
 * Create one transparent, frameless, always-on-top, click-through box. Restores
 * its saved bounds and persists them (debounced) as the user drags/resizes in
 * edit mode. The three boxes differ only in page, defaults, and bounds key.
 */
function createOverlayBox(page: Page, defaults: BoxDefaults, boundsKey: BoundsKey): BrowserWindow {
  const saved = readSettings()[boundsKey];
  const win = new BrowserWindow({
    width: saved?.width ?? defaults.width,
    height: saved?.height ?? defaults.height,
    x: saved?.x ?? defaults.x,
    y: saved?.y ?? defaults.y,
    minWidth: defaults.minWidth,
    minHeight: defaults.minHeight,
    transparent: true,
    frame: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    fullscreenable: false,
    parent: ownerWin ?? undefined,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // Stay above the game; pass clicks through by default.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  loadPage(win, page);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        writeSettings({ ...readSettings(), [boundsKey]: win.getBounds() } satisfies AppSettings);
      }
    }, 400);
  };
  win.on('move', persistBounds);
  win.on('resize', persistBounds);
  return win;
}

function createOwnerWindow(): BrowserWindow {
  // Hidden owner: the overlay boxes are parented to it so Windows treats them as
  // owned tool windows and excludes them from the Alt+Tab switcher. It's never
  // shown, so minimizing the control window doesn't hide the overlays.
  const win = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    transparent: true,
  });
  win.on('closed', () => {
    ownerWin = null;
  });
  return win;
}

function createControlWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'SC Ore Overlay — Control',
    icon: APP_ICON,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Star Citizen runs in the foreground; this control window sits behind and
      // must keep OCR + the capture loop running at full cadence even when it's
      // unfocused. Without this Chromium throttles setTimeout/rAF in hidden/
      // background windows to ~1Hz and capture effectively stalls.
      backgroundThrottling: false,
    },
  });
  loadPage(win, 'index');
  if (DEV_SERVER_URL) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => {
    controlWin = null;
  });
  return win;
}

/** Create the control + owner + three overlay boxes and wire their closed refs. */
export function createAllWindows(): void {
  controlWin = createControlWindow();
  ownerWin = createOwnerWindow();
  overlayWin = createOverlayBox(
    'overlay',
    { width: 320, height: 180, x: 40, y: 40, minWidth: 140, minHeight: 70 },
    'overlayBounds',
  );
  overlayWin.on('closed', () => {
    overlayWin = null;
  });
  detailWin = createOverlayBox(
    'detail',
    { width: 360, height: 200, x: 40, y: 260, minWidth: 160, minHeight: 80 },
    'detailBounds',
  );
  detailWin.on('closed', () => {
    detailWin = null;
  });
  scanWin = createOverlayBox(
    'scan',
    { width: 320, height: 220, x: 40, y: 480, minWidth: 160, minHeight: 80 },
    'scanBounds',
  );
  scanWin.on('closed', () => {
    scanWin = null;
  });
}

/**
 * "Edit overlay" mode: make the boxes interactive so they can be dragged/resized,
 * then lock them back to click-through.
 */
export function setEditMode(on: boolean): void {
  editing = on;
  for (const w of overlayBoxWindows()) {
    w.setIgnoreMouseEvents(!on, { forward: true });
    w.setFocusable(on);
    if (on) w.showInactive();
    w.webContents.send('sco:edit-mode', on);
  }
}

export const toggleEditMode = (): void => setEditMode(!editing);
