import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4001,
    proxy: {
      '/jobs': 'http://localhost:4000',
      '/ingestion': 'http://localhost:4000',
      '/cv': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
});
