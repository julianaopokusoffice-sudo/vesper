import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const apiTarget = process.env.VESPER_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT ?? 3000),
    strictPort: true,
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      ...(process.env.PREVIEW_HOST ? [process.env.PREVIEW_HOST] : []),
      '.style.dev',
    ],
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        // SSE needs these; http-proxy passthrough is default but be explicit.
        configure: () => {},
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
