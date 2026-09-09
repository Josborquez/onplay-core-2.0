import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@onplay/dominio': resolve(__dirname, 'src/dominio/index.ts'),
      '@onplay/woo-client': resolve(__dirname, 'src/woo/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
