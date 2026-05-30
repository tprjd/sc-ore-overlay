// Preload — exposes a typed, sandboxed bridge to the renderer.
// Phase 1/3 expand this with capture-source enumeration, region persistence,
// and IPC to push matches to the overlay window. Phase 0 keeps it minimal.

import { contextBridge } from 'electron';

const api = {
  /** Liveness check so the renderer can confirm the bridge is wired up. */
  ping: (): 'pong' => 'pong',
};

contextBridge.exposeInMainWorld('sco', api);

/** Shape of `window.sco` in the renderer. */
export type ScoApi = typeof api;
