// Electron main process — Phase 0 scaffold.
// Creates the control window. The transparent click-through overlay window,
// global hotkeys, and `desktopCapturer` source enumeration arrive in Phase 1/3.

import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// `vite-plugin-electron` sets VITE_DEV_SERVER_URL during `vite dev`.
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(dirname, '..', 'dist');

function createControlWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
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
