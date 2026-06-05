import { execFileSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';

// Vite ↔ Electron integration (locked stack). The renderer is a normal Vite
// app; the plugin compiles the main + preload processes and launches Electron
// in `vite dev`. Window wiring lands in Phase 1/3.
export default defineConfig(({ command }) => {
  // Before `vite dev` spawns Electron, make sure the installed binary matches
  // this OS — the repo is run from both WSL and native Windows against one
  // shared node_modules, so the binary is often built for the other platform.
  // Run the guard here (not only in the `predev` npm hook) so it can't be
  // skipped by a script runner that ignores pre-scripts. No-op when matched.
  if (command === 'serve') {
    try {
      execFileSync(process.execPath, [resolvePath(process.cwd(), 'scripts/ensure-electron.mjs')], {
        stdio: 'inherit',
      });
    } catch {
      // ensure-electron prints its own guidance; don't block config load.
    }
  }
  return {
    plugins: [
      react(),
      // Package is CommonJS, so the plugin emits CJS main + preload (a sandboxed
      // preload must be CommonJS). The renderer is still bundled as ESM by Vite.
      electron([
        { entry: 'electron/main.ts' },
        {
          entry: 'electron/preload.ts',
          onstart: (args: { reload: () => void }) => args.reload(),
        },
        {
          // Native DirectML OCR host (Electron utilityProcess). Emitted CJS as
          // dist-electron/ocr-host.js and forked from main. @gutenye/ocr-common is
          // ESM and Electron 33's Node can't require() ESM, so it's bundled in;
          // only the native addons (onnxruntime-node, sharp) stay external and load
          // from node_modules at runtime (asarUnpack'd in the packaged build).
          entry: 'electron/ocr-host.ts',
          vite: {
            build: {
              rollupOptions: { external: ['onnxruntime-node', 'sharp'] },
            },
          },
        },
      ]),
    ],
    // OCR now runs in a Web Worker (src/control/ocr.worker.ts). Emit ESM workers so
    // the worker can import onnxruntime-web + @gutenye/ocr-common. Pre-bundle the
    // OCR libs so their CommonJS deps (e.g. js-clipper) get ESM-default interop;
    // keep onnxruntime-web out (it ships WASM) and deduped.
    worker: { format: 'es' },
    optimizeDeps: {
      include: ['@gutenye/ocr-common', '@gutenye/ocr-common/splitIntoLineImages'],
      exclude: ['onnxruntime-web'],
    },
    resolve: { dedupe: ['onnxruntime-web'] },
    // Two renderer entries: the control window and the transparent overlay.
    build: {
      rollupOptions: {
        input: {
          index: resolvePath('index.html'),
          overlay: resolvePath('overlay.html'),
          detail: resolvePath('detail.html'),
          scan: resolvePath('scan.html'),
        },
      },
    },
  };
});
