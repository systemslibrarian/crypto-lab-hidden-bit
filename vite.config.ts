import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/crypto-lab-hidden-bit/',
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/game/**/*.ts',
        'src/schemes/**/*.ts',
        'src/adversaries/**/*.ts',
        'src/prf/**/*.ts',
        'src/reduction/**/*.ts',
        'src/kats.ts',
      ],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});