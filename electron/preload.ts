// Preload — exposes a typed, sandboxed bridge to the renderer as `window.sco`.
// Heavy lifting (desktopCapturer) stays in the main process; the renderer only
// receives plain serializable data over IPC.

import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureSource, ScoBridge } from '../src/shared/bridge';

const api: ScoBridge = {
  getCaptureSources: () =>
    ipcRenderer.invoke('sco:get-capture-sources') as Promise<CaptureSource[]>,
  ping: () => 'pong',
};

contextBridge.exposeInMainWorld('sco', api);
