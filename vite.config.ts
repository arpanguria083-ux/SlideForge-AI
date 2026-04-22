import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',
      server: {
        port: 3000,
        host: '127.0.0.1',
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:8002',
            changeOrigin: true,
            rewrite: (path) => path,
          },
        },
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          output: {
            manualChunks: {
              charts: ['recharts'],
            },
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
