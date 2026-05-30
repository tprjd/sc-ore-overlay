import { defineConfig } from 'vitest/config';

// Pure `src/core` logic runs in a Node environment — no Electron, no DOM.
// A dedicated Vitest config keeps the Electron plugin out of the test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
