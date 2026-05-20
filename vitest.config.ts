import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // Only measure coverage on testable business-logic layers.
      // Infrastructure files (config, logger, slack bootstrap) are intentionally excluded.
      include: ['src/services/**', 'src/repositories/**', 'src/lib/errors.ts'],
      exclude: [],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
