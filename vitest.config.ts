import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      // shared/ used by both electron and src code
      '../shared': path.resolve(__dirname, 'shared'),
      '../../shared': path.resolve(__dirname, 'shared'),
    },
  },
});
