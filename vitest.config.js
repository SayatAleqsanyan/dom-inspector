import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Playwright integration tests have their own runner (npm run test:e2e).
    // Vitest must not pick them up — they use @playwright/test globals
    // (test.describe, page fixtures) that are incompatible with Vitest.
    exclude: [
      '**/node_modules/**',
      '**/*.integration.spec.{js,ts}',
    ],
    coverage: {
      provider: 'v8',
      // 'json-summary' is required for CI threshold check (coverage-summary.json)
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['dist/inspector.js'],
    },
  },
});
