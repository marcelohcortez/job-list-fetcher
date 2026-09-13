import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/jobs': 'http://localhost:3000',
      '/ingestion': 'http://localhost:3000',
      '/cv': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
