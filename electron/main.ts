// Electron main process.
// - Control window (capture/calibrate/match UI) + desktopCapturer over IPC.
// - Transparent, click-through, always-on-top overlay window.
// - Relays matches control → overlay, and global hotkeys → control / overlay.
//
// Built as CommonJS by vite-plugin-electron, so `__dirname` is available.

import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain } from 'electron';
import type { IpcMainEvent } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  CaptureSource,
  OverlayCommand,
  OverlayPayload,
} from '../src/shared/bridge';

const dirname = __dirname;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(dirname, '..', 'dist');
const PRELOAD = path.join(dirname, 'preload.js');

// WSL2 / headless GPU initialization often fails and leaves a blank window.
app.disableHardwareAcceleration();

let controlWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let editing = false;

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

// Control → overlay relay.
ipcMain.on('sco:matches', (_e: IpcMainEvent, payload: OverlayPayload) => {
  overlayWin?.webContents.send('sco:matches', payload);
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
ipcMain.handle('sco:get-settings', (): AppSettings => readSettings());
ipcMain.on('sco:set-settings', (_e: IpcMainEvent, patch: Partial<AppSettings>) => {
  const next: AppSettings = { ...readSettings(), ...patch };
  try {
    mkdirSync(path.dirname(settingsFile()), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch {
    // ignore write errors
  }
});

// --- Windows -----------------------------------------------------------------
function loadPage(win: BrowserWindow, page: 'index' | 'overlay'): void {
  if (DEV_SERVER_URL) {
    const url = page === 'index' ? DEV_SERVER_URL : new URL('overlay.html', DEV_SERVER_URL).href;
    void win.loadURL(url);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, `${page}.html`));
  }
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
  const win = new BrowserWindow({
    width: 320,
    height: 180,
    x: 40,
    y: 40,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    fullscreenable: false,
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
  win.on('closed', () => {
    overlayWin = null;
  });
  return win;
}

// "Edit overlay" mode: make the overlay interactive so it can be dragged, then
// lock it back to click-through.
function setEditMode(on: boolean): void {
  if (!overlayWin) return;
  editing = on;
  overlayWin.setIgnoreMouseEvents(!on, { forward: true });
  overlayWin.setFocusable(on);
  if (on) {
    overlayWin.showInactive();
    overlayWin.focus();
  }
  overlayWin.webContents.send('sco:edit-mode', on);
}

function toCommand(command: OverlayCommand): void {
  controlWin?.webContents.send('sco:command', command);
}

function registerShortcuts(): void {
  // Toggle overlay visibility.
  globalShortcut.register('Alt+Shift+O', () => {
    if (!overlayWin) return;
    if (overlayWin.isVisible()) overlayWin.hide();
    else overlayWin.showInactive();
  });
  // Pause/resume OCR (handled in the control window).
  globalShortcut.register('Alt+Shift+P', () => toCommand('pause'));
  // Re-enter calibration (clear the region) and surface the control window.
  globalShortcut.register('Alt+Shift+R', () => {
    toCommand('recalibrate');
    controlWin?.show();
  });
  // Toggle "edit overlay" mode.
  globalShortcut.register('Alt+Shift+E', () => setEditMode(!editing));
}

void app.whenReady().then(() => {
  controlWin = createControlWindow();
  overlayWin = createOverlayWindow();
  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWin = createControlWindow();
      overlayWin = createOverlayWindow();
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
