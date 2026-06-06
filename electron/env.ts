// Shared main-process paths/constants. Built as CommonJS by vite-plugin-electron,
// so `__dirname` is available.

import path from 'node:path';

const dirname = __dirname;

export const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
/** dist-electron/ — holds the compiled main/preload/ocr-host. */
export const DIST_ELECTRON = dirname;
export const RENDERER_DIST = path.join(dirname, '..', 'dist');
export const PRELOAD = path.join(dirname, 'preload.js');

// Window/taskbar icon. build.win.icon only sets the packaged .exe icon, so the
// running window (esp. in `vite dev`, and on Linux) still needs this explicitly.
// Dev: read from the repo build/ dir; prod: shipped via extraResources.
export const APP_ICON = DEV_SERVER_URL
  ? path.join(dirname, '..', 'build', 'icon.png')
  : path.join(process.resourcesPath, 'icon.png');
