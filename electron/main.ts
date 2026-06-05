// Electron main process.
// - Control window (capture/calibrate/match UI) + desktopCapturer over IPC.
// - Transparent, click-through, always-on-top overlay window.
// - Relays matches control → overlay, and global hotkeys → control / overlay.
//
// Built as CommonJS by vite-plugin-electron, so `__dirname` is available.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { IpcMainEvent, IpcMainInvokeEvent, UtilityProcess } from 'electron';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  shell,
  utilityProcess,
} from 'electron';
import type { SurveyEntry } from '../src/core/survey';
import type {
  AppSettings,
  CaptureSource,
  HotkeyAction,
  HotkeyMap,
  OcrLine,
  OverlayCommand,
  OverlayConfig,
  OverlayPayload,
} from '../src/shared/bridge';
import { DEFAULT_HOTKEYS } from '../src/shared/bridge';
import { installCrashHandlers, log } from './log';
import { checkForUpdate } from './update';

const dirname = __dirname;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(dirname, '..', 'dist');
const PRELOAD = path.join(dirname, 'preload.js');
// Window/taskbar icon. build.win.icon only sets the packaged .exe icon, so the
// running window (esp. in `vite dev`, and on Linux) still needs this explicitly.
// Dev: read from the repo build/ dir; prod: shipped via extraResources.
const APP_ICON = DEV_SERVER_URL
  ? path.join(dirname, '..', 'build', 'icon.png')
  : path.join(process.resourcesPath, 'icon.png');

// Capture crashes/throws to <userData>/logs/main.log before anything else can
// fail silently (see electron/log.ts).
installCrashHandlers();

// WSL2 / headless Linux GPU init often fails and leaves a blank window. On the
// real target (Windows) keep hardware acceleration ON so the OCR worker can use
// the WebGPU execution provider.
if (process.platform === 'linux') app.disableHardwareAcceleration();

let controlWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let detailWin: BrowserWindow | null = null;
let scanWin: BrowserWindow | null = null;
let ownerWin: BrowserWindow | null = null;
let editing = false;

/** The transparent boxes (overlay + detail + scan) that currently exist. */
const overlayWindows = (): BrowserWindow[] =>
  [overlayWin, detailWin, scanWin].filter((w): w is BrowserWindow => w !== null);

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
  // Broadcast to the overlay boxes AND the control window: the control holds
  // the canonical config in React state, and a change can originate from the
  // overlay itself (e.g. sorting the scanned-rock card in edit mode), so it
  // must hear back to stay in sync.
  for (const w of [controlWin, ...overlayWindows()])
    w?.webContents.send('sco:overlay-config', config);
});
ipcMain.on('sco:overlay-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
  overlayWin?.setSize(Math.max(140, Math.round(size.width)), Math.max(70, Math.round(size.height)));
});
ipcMain.on('sco:detail-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
  detailWin?.setSize(Math.max(160, Math.round(size.width)), Math.max(80, Math.round(size.height)));
});
ipcMain.on('sco:scan-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
  scanWin?.setSize(Math.max(160, Math.round(size.width)), Math.max(80, Math.round(size.height)));
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

// --- Update check ------------------------------------------------------------
// Renderer-pulled at startup (one shot). See electron/update.ts.
ipcMain.handle('sco:check-updates', () => checkForUpdate());
ipcMain.on('sco:open-external', (_e: IpcMainEvent, url: string) => {
  // Only ever open external https links (release pages) — never arbitrary
  // schemes (file:, javascript:, custom protocols) from the renderer.
  if (/^https:\/\//i.test(url)) void shell.openExternal(url);
});

// About panel: app version + open the log folder for bug reports.
ipcMain.handle('sco:app-version', (): string => app.getVersion());
ipcMain.on('sco:open-logs', () => {
  void shell.openPath(path.dirname(log.path()));
});

// --- Native OCR host (utility process) ---------------------------------------
// A Node child with its own D3D12 device runs onnxruntime-node + DirectML, so
// GPU OCR doesn't contend with the overlay the way in-renderer WebGPU does (see
// electron/ocr-host.ts / TASKS.md R4). Spawned lazily on first probe; the
// renderer falls back to the in-renderer WASM worker if it can't start.
let ocrHost: UtilityProcess | null = null;
let ocrReady: Promise<boolean> | null = null;
let ocrSeq = 0;
const ocrPending = new Map<
  number,
  { resolve: (lines: OcrLine[]) => void; reject: (err: Error) => void }
>();

/** Absolute dir holding the PP-OCR models (dev: public/models; prod: resources). */
function ocrModelDir(): string {
  return DEV_SERVER_URL
    ? path.join(dirname, '..', 'public', 'models')
    : path.join(process.resourcesPath, 'models');
}

/** Fork the OCR host (once) and resolve true when DirectML/CPU init succeeds. */
function startOcrHost(): Promise<boolean> {
  if (ocrReady) return ocrReady;
  ocrReady = new Promise<boolean>((resolve) => {
    let host: UtilityProcess;
    try {
      // Pipe (not inherit) so the host's stdout/stderr land in main.log too —
      // packaged builds have no terminal, and OCR is the most failure-prone path.
      host = utilityProcess.fork(path.join(dirname, 'ocr-host.js'), [], {
        serviceName: 'sco-ocr-host',
        stdio: 'pipe',
      });
    } catch (err) {
      log.error('[ocr] failed to fork host:', err);
      ocrReady = null;
      resolve(false);
      return;
    }
    ocrHost = host;
    host.stdout?.on('data', (d: Buffer) => log.info('[ocr-host]', d.toString().trimEnd()));
    host.stderr?.on('data', (d: Buffer) => log.warn('[ocr-host]', d.toString().trimEnd()));
    const dir = ocrModelDir();
    host.on('spawn', () => {
      host.postMessage({
        type: 'init',
        models: {
          detectionPath: path.join(dir, 'ch_PP-OCRv4_det_infer.onnx'),
          recognitionPath: path.join(dir, 'ch_PP-OCRv4_rec_infer.onnx'),
          dictionaryPath: path.join(dir, 'ppocr_keys_v1.txt'),
        },
      });
    });
    host.on('message', (msg: { type: string; id?: number; lines?: OcrLine[]; error?: string }) => {
      if (msg.type === 'ready') {
        resolve(true);
      } else if (msg.type === 'init-error') {
        log.error('[ocr] host init error:', msg.error);
        resolve(false);
      } else if (msg.type === 'result' && typeof msg.id === 'number') {
        const p = ocrPending.get(msg.id);
        if (!p) return;
        ocrPending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.lines ?? []);
      }
    });
    host.on('exit', (code) => {
      log.warn('[ocr] host exited:', code);
      ocrHost = null;
      ocrReady = null; // allow a re-spawn on the next probe
      for (const p of ocrPending.values()) p.reject(new Error('OCR host exited'));
      ocrPending.clear();
      resolve(false); // no-op if already resolved (e.g. ready earlier)
    });
  });
  return ocrReady;
}

ipcMain.handle('sco:ocr-available', (): Promise<boolean> => startOcrHost());
ipcMain.handle(
  'sco:ocr-recognize',
  async (_e: IpcMainInvokeEvent, dataUrl: string): Promise<OcrLine[]> => {
    const ok = await startOcrHost();
    if (!ok || !ocrHost) throw new Error('OCR host unavailable');
    const host = ocrHost;
    const id = ++ocrSeq;
    return new Promise<OcrLine[]>((resolve, reject) => {
      ocrPending.set(id, { resolve, reject });
      host.postMessage({ type: 'recognize', id, dataUrl });
    });
  },
);

// --- Windows -----------------------------------------------------------------
function loadPage(win: BrowserWindow, page: 'index' | 'overlay' | 'detail' | 'scan'): void {
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
    icon: APP_ICON,
    backgroundColor: '#16181d',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Star Citizen runs in the foreground; this control window sits behind
      // and must keep OCR + the capture loop running at full cadence even when
      // it's unfocused. Without this Chromium throttles setTimeout/rAF in
      // hidden/background windows to ~1Hz and capture effectively stalls.
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
      backgroundThrottling: false,
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
      backgroundThrottling: false,
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

function createScanWindow(): BrowserWindow {
  const saved = readSettings().scanBounds;
  const win = new BrowserWindow({
    width: saved?.width ?? 320,
    height: saved?.height ?? 220,
    x: saved?.x ?? 40,
    y: saved?.y ?? 480,
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
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  loadPage(win, 'scan');

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (scanWin) writeSettings({ ...readSettings(), scanBounds: scanWin.getBounds() });
    }, 400);
  };
  win.on('move', persistBounds);
  win.on('resize', persistBounds);

  win.on('closed', () => {
    scanWin = null;
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
  log.info(`SC Ore Overlay v${app.getVersion()} starting (electron ${process.versions.electron})`);
  controlWin = createControlWindow();
  ownerWin = createOwnerWindow();
  overlayWin = createOverlayWindow();
  detailWin = createDetailWindow();
  scanWin = createScanWindow();
  applyHotkeys(currentHotkeys());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWin = createControlWindow();
      ownerWin = createOwnerWindow();
      overlayWin = createOverlayWindow();
      detailWin = createDetailWindow();
      scanWin = createScanWindow();
    }
  });
});

app.on('will-quit', () => {
  log.info('app quitting');
  globalShortcut.unregisterAll();
  ocrHost?.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
