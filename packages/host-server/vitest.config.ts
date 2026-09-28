import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Never let a test fall back to the developer's real ~/.piwin.
    setupFiles: ['../../vitest.piwin-root-isolation.ts'],
  },
});
