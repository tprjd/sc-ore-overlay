// Electron main process.
// Phase 1: control window + `desktopCapturer` source enumeration over IPC.
// The transparent click-through overlay window and global hotkeys arrive in
// Phase 3.

import { app, BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import path from 'node:path';
import type { CaptureSource } from '../src/shared/bridge';

// Built as CommonJS by vite-plugin-electron, so `__dirname` is available.
const dirname = __dirname;

// `vite-plugin-electron` sets VITE_DEV_SERVER_URL during `vite dev`.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(dirname, '..', 'dist');

// WSL2 / headless GPU initialization often fails and leaves a blank window.
// Software rendering is fine for the control window.
app.disableHardwareAcceleration();

// Enumerate capturable screens/windows. The renderer turns the chosen id into a
// MediaStream via getUserMedia({ chromeMediaSource: 'desktop', ... }).
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

function createControlWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'SC Ore Overlay — Control',
    backgroundColor: '#16181d',
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  createControlWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
