import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4001,
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT ?? 4000}`,
    },
  },
});
