import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
    // Benches import dist/ so it runs as plain Node ESM; vitest's module runner would otherwise wrap every
    // export in a getter and skew the results.
    server: { deps: { external: [/\/dist\//] } },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/meta-schema.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
