// Core IPC handlers (everything except OCR + hotkeys, which register their own):
// capture-source enumeration, control→overlay relays, settings get/set/reset,
// overlay-config broadcast, box resizes, survey log, update check, and the
// open-external / version / open-logs helpers.

import path from 'node:path';
import type { IpcMainEvent } from 'electron';
import { app, desktopCapturer, ipcMain, shell } from 'electron';
import type { CrawlProgress } from '../src/core/crawl';
import type { SurveyEntry } from '../src/core/survey';
import type { SignatureTable } from '../src/core/types';
import type {
  AppSettings,
  CaptureSource,
  OverlayConfig,
  OverlayPayload,
} from '../src/shared/bridge';
import { log } from './log';
import {
  deleteSettings,
  patchSettings,
  readSettings,
  readSurveyLog,
  writeSettings,
  writeSurveyLog,
} from './settings';
import { crawlAndSave, loadCrawledTables, syncTables } from './tables';
import { checkForUpdate } from './update';
import { controlWindow, detailBox, overlayBox, overlayBoxWindows, scanBox } from './windows';

const clampResize = (v: number, min: number): number => Math.max(min, Math.round(v));

export function registerCoreIpc(): void {
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
    for (const w of overlayBoxWindows()) w.webContents.send('sco:matches', payload);
  });

  // --- Settings ---
  ipcMain.handle('sco:get-settings', (): AppSettings => readSettings());
  ipcMain.on('sco:set-settings', (_e: IpcMainEvent, patch: Partial<AppSettings>) => {
    patchSettings(patch);
  });
  // Factory reset: delete settings.json and relaunch to a clean first-run state.
  // The survey log (separate file) is intentionally left intact.
  ipcMain.on('sco:reset-settings', () => {
    try {
      deleteSettings();
      log.info('settings reset by user');
    } catch (e) {
      log.error('settings reset failed', e);
    }
    app.relaunch();
    app.exit(0);
  });
  ipcMain.on('sco:overlay-config', (_e: IpcMainEvent, config: OverlayConfig) => {
    writeSettings({ ...readSettings(), overlay: config });
    // Broadcast to the overlay boxes AND the control window: the control holds the
    // canonical config in React state, and a change can originate from the overlay
    // itself (e.g. sorting the scanned-rock card in edit mode), so it must hear
    // back to stay in sync.
    for (const w of [controlWindow(), ...overlayBoxWindows()])
      w?.webContents.send('sco:overlay-config', config);
  });

  // --- Box resizes ---
  ipcMain.on('sco:overlay-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
    overlayBox()?.setSize(clampResize(size.width, 140), clampResize(size.height, 70));
  });
  ipcMain.on('sco:detail-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
    detailBox()?.setSize(clampResize(size.width, 160), clampResize(size.height, 80));
  });
  ipcMain.on('sco:scan-resize', (_e: IpcMainEvent, size: { width: number; height: number }) => {
    scanBox()?.setSize(clampResize(size.width, 160), clampResize(size.height, 80));
  });

  // --- Signature tables (runtime crawl) ---
  // The renderer seeds from its bundled fallback, then merges these crawled
  // tables (preferring them per patch). Startup sync + manual refresh both write
  // to userData and notify via 'sco:tables-updated' / 'sco:crawl-progress'.
  ipcMain.handle('sco:get-tables', (): SignatureTable[] => loadCrawledTables());
  // Renderer-driven startup sync: crawl only if the live patch is newer than the
  // newest the renderer already has (bundled + crawled). Notifies via events.
  ipcMain.on('sco:sync-tables', (_e: IpcMainEvent, newestHave: string | null) => {
    void syncTables(newestHave, (channel: string, payload?: unknown) =>
      controlWindow()?.webContents.send(channel, payload),
    );
  });
  ipcMain.handle('sco:refresh-tables', async (): Promise<SignatureTable | null> => {
    const send = (channel: string, payload?: unknown): void =>
      controlWindow()?.webContents.send(channel, payload);
    try {
      const table = await crawlAndSave(undefined, (p: CrawlProgress) =>
        send('sco:crawl-progress', p),
      );
      send('sco:crawl-progress', { phase: 'done', done: 1, total: 1 });
      send('sco:tables-updated');
      return table;
    } catch (e) {
      log.error('manual ore-data refresh failed', e);
      send('sco:crawl-progress', { phase: 'error', done: 0, total: 0 });
      return null;
    }
  });

  // --- Survey scan log ---
  ipcMain.handle('sco:get-survey-log', (): SurveyEntry[] => readSurveyLog());
  ipcMain.on('sco:save-survey-log', (_e: IpcMainEvent, entries: SurveyEntry[]) => {
    writeSurveyLog(entries);
  });

  // --- Update check / helpers ---
  ipcMain.handle('sco:check-updates', () => checkForUpdate());
  ipcMain.on('sco:open-external', (_e: IpcMainEvent, url: string) => {
    // Only ever open external https links (release pages) — never arbitrary
    // schemes (file:, javascript:, custom protocols) from the renderer.
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
  });
  ipcMain.handle('sco:app-version', (): string => app.getVersion());
  ipcMain.on('sco:open-logs', () => {
    void shell.openPath(path.dirname(log.path()));
  });
}
