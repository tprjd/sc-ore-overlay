import { resolve as resolvePath } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';

// Vite ↔ Electron integration (locked stack). The renderer is a normal Vite
// app; the plugin compiles the main + preload processes and launches Electron
// in `vite dev`. Window wiring lands in Phase 1/3.
export default defineConfig({
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
    ]),
  ],
  // Pre-bundle @gutenye/ocr-browser so its CommonJS deps (e.g. js-clipper) get
  // proper ESM-default interop. Keep onnxruntime-web out (it ships WASM) and
  // deduped, so we can set its wasm paths from a single instance.
  optimizeDeps: {
    include: ['@gutenye/ocr-browser'],
    exclude: ['onnxruntime-web'],
  },
  resolve: { dedupe: ['onnxruntime-web'] },
  // Two renderer entries: the control window and the transparent overlay.
  build: {
    rollupOptions: {
      input: {
        index: resolvePath('index.html'),
        overlay: resolvePath('overlay.html'),
      },
    },
  },
});
