// Navigation hardening + Content-Security-Policy. Standard Electron hardening: a
// sandboxed, context-isolated renderer must never navigate itself to a remote
// page or spawn arbitrary child windows; external https (release/GitHub links)
// is routed through the OS browser.

import { app, session, shell } from 'electron';
import { DEV_SERVER_URL } from './env';

/**
 * CSP for the packaged (file://) build. Applied as a response header (not a
 * <meta> tag) so it covers workers and never touches the Vite dev server, which
 * needs inline/eval/ws for HMR. The primary OCR path (native DirectML host) runs
 * outside the renderer and is unaffected; the in-renderer WASM *fallback* pulls
 * ONNX Runtime's wasm from the pinned jsDelivr CDN, so that origin is allowed.
 * Everything else is locked to the app's own files.
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' data: blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

/** Deny self-navigation + child windows; route external https to the OS browser. */
export function installNavigationHardening(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      // Allow only the app's own pages: the Vite dev server in dev, file:// in prod.
      const ok = DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
      if (!ok) {
        e.preventDefault();
        if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      }
    });
  });
}

export function installContentSecurityPolicy(): void {
  if (DEV_SERVER_URL) return; // dev: Vite HMR needs a looser policy — skip.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PROD_CSP],
      },
    });
  });
}
