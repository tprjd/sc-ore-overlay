// Preload — exposes a typed, sandboxed bridge to the renderer as `window.sco`.
// Shared by both the control and overlay windows; each uses the relevant subset.

import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron';
import type { CrawlProgress } from '../src/core/crawl';
import type { SurveyEntry } from '../src/core/survey';
import type { SignatureTable } from '../src/core/types';
import type {
  AppSettings,
  CaptureSource,
  HotkeyAction,
  HotkeyMap,
  OcrLine,
  OverlayCommand,
  OverlayConfig,
  OverlayPayload,
  ScoBridge,
  UpdateInfo,
} from '../src/shared/bridge';

const api: ScoBridge = {
  getCaptureSources: () =>
    ipcRenderer.invoke('sco:get-capture-sources') as Promise<CaptureSource[]>,
  ping: () => 'pong',
  getSettings: () => ipcRenderer.invoke('sco:get-settings') as Promise<AppSettings>,
  setSettings: (patch) => ipcRenderer.send('sco:set-settings', patch),
  resetSettings: () => ipcRenderer.send('sco:reset-settings'),
  setHotkeys: (map: HotkeyMap) =>
    ipcRenderer.invoke('sco:set-hotkeys', map) as Promise<Record<HotkeyAction, boolean>>,

  sendMatches: (payload) => ipcRenderer.send('sco:matches', payload),

  onMatches: (cb) => {
    const handler = (_e: IpcRendererEvent, payload: OverlayPayload): void => cb(payload);
    ipcRenderer.on('sco:matches', handler);
    return () => ipcRenderer.off('sco:matches', handler);
  },

  onCommand: (cb) => {
    const handler = (_e: IpcRendererEvent, command: OverlayCommand): void => cb(command);
    ipcRenderer.on('sco:command', handler);
    return () => ipcRenderer.off('sco:command', handler);
  },

  onEditMode: (cb) => {
    const handler = (_e: IpcRendererEvent, editing: boolean): void => cb(editing);
    ipcRenderer.on('sco:edit-mode', handler);
    return () => ipcRenderer.off('sco:edit-mode', handler);
  },

  setOverlayConfig: (config) => ipcRenderer.send('sco:overlay-config', config),
  onOverlayConfig: (cb) => {
    const handler = (_e: IpcRendererEvent, config: OverlayConfig): void => cb(config);
    ipcRenderer.on('sco:overlay-config', handler);
    return () => ipcRenderer.off('sco:overlay-config', handler);
  },
  resizeOverlay: (size) => ipcRenderer.send('sco:overlay-resize', size),
  onToggleVisible: (cb) => {
    const handler = (): void => cb();
    ipcRenderer.on('sco:overlay-toggle', handler);
    return () => ipcRenderer.off('sco:overlay-toggle', handler);
  },
  resizeDetail: (size) => ipcRenderer.send('sco:detail-resize', size),
  resizeScan: (size) => ipcRenderer.send('sco:scan-resize', size),

  getSurveyLog: () => ipcRenderer.invoke('sco:get-survey-log') as Promise<SurveyEntry[]>,
  saveSurveyLog: (entries) => ipcRenderer.send('sco:save-survey-log', entries),

  ocrAvailable: () => ipcRenderer.invoke('sco:ocr-available') as Promise<boolean>,
  ocrRecognize: (dataUrl: string) =>
    ipcRenderer.invoke('sco:ocr-recognize', dataUrl) as Promise<OcrLine[]>,

  getCrawledTables: () => ipcRenderer.invoke('sco:get-tables') as Promise<SignatureTable[]>,
  syncTables: (newestHave) => ipcRenderer.send('sco:sync-tables', newestHave),
  refreshTables: () => ipcRenderer.invoke('sco:refresh-tables') as Promise<SignatureTable | null>,
  onTablesUpdated: (cb) => {
    const handler = (): void => cb();
    ipcRenderer.on('sco:tables-updated', handler);
    return () => ipcRenderer.off('sco:tables-updated', handler);
  },
  onCrawlProgress: (cb) => {
    const handler = (_e: IpcRendererEvent, p: CrawlProgress): void => cb(p);
    ipcRenderer.on('sco:crawl-progress', handler);
    return () => ipcRenderer.off('sco:crawl-progress', handler);
  },

  checkForUpdates: () => ipcRenderer.invoke('sco:check-updates') as Promise<UpdateInfo>,
  openExternal: (url: string) => ipcRenderer.send('sco:open-external', url),
  appVersion: () => ipcRenderer.invoke('sco:app-version') as Promise<string>,
  openLogs: () => ipcRenderer.send('sco:open-logs'),
};

contextBridge.exposeInMainWorld('sco', api);
