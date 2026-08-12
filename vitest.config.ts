import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.ts', 'shared/**/*.test.ts'],
    // Each suite mutates process.env (NODE_ENV, CORS_ORIGINS) before importing
    // the modules under test, so files must not share a process.
    isolate: true,
  },
});
