import type { ScoBridge } from './shared/bridge';

declare global {
  interface Window {
    /** Bridge exposed by the Electron preload (see `electron/preload.ts`). */
    sco: ScoBridge;
  }
}

export {};
