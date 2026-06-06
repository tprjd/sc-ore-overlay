// Electron main process — lifecycle glue. The substance lives in modules:
// - windows.ts   control window + the three transparent overlay boxes
// - ipc.ts       core IPC (capture, settings, overlay relay, survey log, update)
// - ocr.ts       native DirectML OCR host client + its IPC
// - hotkeys.ts   global shortcuts + set-hotkeys IPC
// - settings.ts  userData persistence (settings.json + survey log)
// - security.ts  navigation hardening + CSP
//
// Built as CommonJS by vite-plugin-electron.

import { app, BrowserWindow } from 'electron';
import { applyHotkeys, currentHotkeys, registerHotkeyIpc, unregisterAllHotkeys } from './hotkeys';
import { registerCoreIpc } from './ipc';
import { installCrashHandlers, log } from './log';
import { killOcrHost, registerOcrIpc } from './ocr';
import { installContentSecurityPolicy, installNavigationHardening } from './security';
import { runStartupTableSync } from './tables';
import { controlWindow, createAllWindows } from './windows';

// Capture crashes/throws to <userData>/logs/main.log before anything else can
// fail silently (see electron/log.ts).
installCrashHandlers();

// WSL2 / headless Linux GPU init often fails and leaves a blank window. On the
// real target (Windows) keep hardware acceleration ON so the OCR worker can use
// the WebGPU execution provider.
if (process.platform === 'linux') app.disableHardwareAcceleration();

installNavigationHardening();

void app.whenReady().then(() => {
  log.info(`SC Ore Overlay v${app.getVersion()} starting (electron ${process.versions.electron})`);
  installContentSecurityPolicy();
  registerCoreIpc();
  registerOcrIpc();
  registerHotkeyIpc();
  createAllWindows();
  applyHotkeys(currentHotkeys());

  // Crawl/refresh ore data in the background (first run, newer patch, etc.).
  // Deferred a tick so the control renderer can subscribe to progress/updated
  // events first; never awaited, so it can't block or crash startup.
  setTimeout(() => {
    void runStartupTableSync((channel, payload) =>
      controlWindow()?.webContents.send(channel, payload),
    );
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createAllWindows();
  });
});

app.on('will-quit', () => {
  log.info('app quitting');
  unregisterAllHotkeys();
  killOcrHost();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
