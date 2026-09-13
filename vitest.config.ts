import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@job-fetcher/domain': path.resolve(__dirname, 'packages/domain/src'),
      '@job-fetcher/source-adapters': path.resolve(
        __dirname,
        'packages/source-adapters/src',
      ),
      '@job-fetcher/database': path.resolve(__dirname, 'packages/database/src'),
      '@job-fetcher/config': path.resolve(__dirname, 'packages/config/src'),
      '@job-fetcher/test-utils': path.resolve(
        __dirname,
        'packages/test-utils/src',
      ),
      '@job-fetcher/cv-match': path.resolve(__dirname, 'packages/cv-match/src'),
    },
  },
});
