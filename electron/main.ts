// Electron main process.
// - Control window (capture/calibrate/match UI) + desktopCapturer over IPC.
// - Transparent, click-through, always-on-top overlay window.
// - Relays matches control → overlay, and global hotkeys → control / overlay.
//
// Built as CommonJS by vite-plugin-electron, so `__dirname` is available.

import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_HOTKEYS } from '../src/shared/bridge';
import type {
  AppSettings,
  CaptureSource,
  HotkeyAction,
  HotkeyMap,
  OverlayCommand,
  OverlayConfig,
  OverlayPayload,
} from '../src/shared/bridge';
import type { SurveyEntry } from '../src/core/survey';

const dirname = __dirname;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(dirname, '..', 'dist');
const PRELOAD = path.join(dirname, 'preload.js');

// WSL2 / headless GPU initialization often fails and leaves a blank window.
app.disableHardwareAcceleration();

let controlWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let detailWin: BrowserWindow | null = null;
let ownerWin: BrowserWindow | null = null;
let editing = false;

/** The transparent boxes (overlay + detail) that currently exist. */
const overlayWindows = (): BrowserWindow[] =>
  [overlayWin, detailWin].filter((w): w is BrowserWindow => w !== null);

// --- IPC ---------------------------------------------------------------------
ipcMain.handle('sco:get-capture-sources', async (): Promise<CaptureSource[]> => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnailDataUrl: s.thumbnail.toDataURL(),
    type: s.id.startsWith('screen') ? 'screen' : 'window',
  }));
});

// Control → both boxes (overlay reads candidates, detail reads payload.detail).
ipcMain.on('sco:matches', (_e: IpcMainEvent, payload: OverlayPayload) => {
  for (const w of overlayWindows()) w.webContents.send('sco:matches', payload);
});

// Settings persistence (Electron userData/settings.json).
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');
function readSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8')) as AppSettings;
  } catch {
    return {};
  }
}
function writeSettings(next: AppSettings): void {
  try {
    mkdirSync(path.dirname(settingsFile()), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch {
    // ignore write errors
  }
}
ipcMain.handle('sco:get-settings', (): AppSettings => readSettings());
ipcMain.on('sco:set-settings', (_e: IpcMainEvent, patch: Partial<AppSettings>) => {
  writeSettings({ ...readSettings(), ...patch });
});
ipcMain.on('sco:overlay-config', (_e: IpcMainEvent, config: OverlayConfig) => {
  writeSettings({ ...readSettings(), overlay: config });
  for (const w of overlayWindows()) w.webContents.send('sco:overlay-config', config);
});
ipcMain.on('sco:overlay-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
  overlayWin?.setSize(Math.max(140, Math.round(size.width)), Math.max(70, Math.round(size.height)));
});
ipcMain.on('sco:detail-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
  detailWin?.setSize(Math.max(160, Math.round(size.width)), Math.max(80, Math.round(size.height)));
});

// Survey scan log — its own file (it can grow large; kept out of settings.json).
const surveyLogFile = (): string => path.join(app.getPath('userData'), 'survey-log.json');
function readSurveyLog(): SurveyEntry[] {
  try {
    const data = JSON.parse(readFileSync(surveyLogFile(), 'utf8')) as SurveyEntry[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
ipcMain.handle('sco:get-survey-log', (): SurveyEntry[] => readSurveyLog());
ipcMain.on('sco:save-survey-log', (_e: IpcMainEvent, entries: SurveyEntry[]) => {
  try {
    mkdirSync(path.dirname(surveyLogFile()), { recursive: true });
    writeFileSync(surveyLogFile(), JSON.stringify(entries));
  } catch {
    // ignore write errors
  }
});

// --- Windows -----------------------------------------------------------------
function loadPage(win: BrowserWindow, page: 'index' | 'overlay' | 'detail'): void {
  if (DEV_SERVER_URL) {
    const url = page === 'index' ? DEV_SERVER_URL : new URL(`${page}.html`, DEV_SERVER_URL).href;
    void win.loadURL(url);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, `${page}.html`));
  }
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
    backgroundColor: '#16181d',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loadPage(win, 'index');
  if (DEV_SERVER_URL) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => {
    controlWin = null;
  });
  return win;
}

function createOverlayWindow(): BrowserWindow {
  const saved = readSettings().overlayBounds;
  const win = new BrowserWindow({
    width: saved?.width ?? 320,
    height: saved?.height ?? 180,
    x: saved?.x ?? 40,
    y: saved?.y ?? 40,
    minWidth: 140,
    minHeight: 70,
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
    },
  });
  // Stay above the game; pass clicks through by default.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  loadPage(win, 'overlay');

  // Persist position/size (debounced) as the user drags/resizes in edit mode.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (overlayWin) writeSettings({ ...readSettings(), overlayBounds: overlayWin.getBounds() });
    }, 400);
  };
  win.on('move', persistBounds);
  win.on('resize', persistBounds);

  win.on('closed', () => {
    overlayWin = null;
  });
  return win;
}

function createDetailWindow(): BrowserWindow {
  const saved = readSettings().detailBounds;
  const win = new BrowserWindow({
    width: saved?.width ?? 360,
    height: saved?.height ?? 200,
    x: saved?.x ?? 40,
    y: saved?.y ?? 260,
    minWidth: 160,
    minHeight: 80,
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
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  loadPage(win, 'detail');

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (detailWin) writeSettings({ ...readSettings(), detailBounds: detailWin.getBounds() });
    }, 400);
  };
  win.on('move', persistBounds);
  win.on('resize', persistBounds);

  win.on('closed', () => {
    detailWin = null;
  });
  return win;
}

// "Edit overlay" mode: make both boxes interactive so they can be dragged/
// resized, then lock them back to click-through.
function setEditMode(on: boolean): void {
  editing = on;
  for (const w of overlayWindows()) {
    w.setIgnoreMouseEvents(!on, { forward: true });
    w.setFocusable(on);
    if (on) w.showInactive();
    w.webContents.send('sco:edit-mode', on);
  }
}

function toCommand(command: OverlayCommand): void {
  controlWin?.webContents.send('sco:command', command);
}

function hotkeyHandlers(): Record<HotkeyAction, () => void> {
  return {
    // Toggle overlay visibility (renderer-side flag — reliable and independent
    // of the idle-fade and of transparent/always-on-top window quirks).
    toggleOverlay: () => {
      for (const w of overlayWindows()) w.webContents.send('sco:overlay-toggle');
    },
    // Pause/resume OCR (handled in the control window).
    pause: () => toCommand('pause'),
    // Re-enter calibration (clear the region) and surface the control window.
    recalibrate: () => {
      toCommand('recalibrate');
      controlWin?.show();
    },
    // Toggle "edit overlay" mode.
    editOverlay: () => setEditMode(!editing),
  };
}

function currentHotkeys(): HotkeyMap {
  return { ...DEFAULT_HOTKEYS, ...(readSettings().hotkeys ?? {}) };
}

// (Re-)register every global hotkey. Returns which bindings registered OK
// (false = invalid accelerator or already taken by another app).
function applyHotkeys(map: HotkeyMap): Record<HotkeyAction, boolean> {
  globalShortcut.unregisterAll();
  const handlers = hotkeyHandlers();
  const results = {} as Record<HotkeyAction, boolean>;
  (Object.keys(handlers) as HotkeyAction[]).forEach((action) => {
    const accel = map[action];
    try {
      results[action] = accel ? globalShortcut.register(accel, handlers[action]) : false;
    } catch {
      results[action] = false;
    }
  });
  return results;
}

ipcMain.handle(
  'sco:set-hotkeys',
  (_e: IpcMainInvokeEvent, map: HotkeyMap): Record<HotkeyAction, boolean> => {
    const results = applyHotkeys(map);
    writeSettings({ ...readSettings(), hotkeys: map });
    return results;
  },
);

void app.whenReady().then(() => {
  controlWin = createControlWindow();
  ownerWin = createOwnerWindow();
  overlayWin = createOverlayWindow();
  detailWin = createDetailWindow();
  applyHotkeys(currentHotkeys());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWin = createControlWindow();
      ownerWin = createOwnerWindow();
      overlayWin = createOverlayWindow();
      detailWin = createDetailWindow();
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
