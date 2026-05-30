import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';

// Vite ↔ Electron integration (locked stack). The renderer is a normal Vite
// app; the plugin compiles the main + preload processes and launches Electron
// in `vite dev`. Window wiring lands in Phase 1/3.
export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: 'electron/main.ts' },
      {
        entry: 'electron/preload.ts',
        onstart: (args: { reload: () => void }) => args.reload(),
      },
    ]),
  ],
});
