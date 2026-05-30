// Preload — exposes a typed, sandboxed bridge to the renderer as `window.sco`.
// Shared by both the control and overlay windows; each uses the relevant subset.

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  AppSettings,
  CaptureSource,
  OverlayCommand,
  OverlayPayload,
  ScoBridge,
} from '../src/shared/bridge';

const api: ScoBridge = {
  getCaptureSources: () =>
    ipcRenderer.invoke('sco:get-capture-sources') as Promise<CaptureSource[]>,
  ping: () => 'pong',
  getSettings: () => ipcRenderer.invoke('sco:get-settings') as Promise<AppSettings>,
  setSettings: (patch) => ipcRenderer.send('sco:set-settings', patch),

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
};

contextBridge.exposeInMainWorld('sco', api);
