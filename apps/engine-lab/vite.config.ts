import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Üç sayfa: seçim, Babylon.js, Three.js. Her motor ayrı giriş: paket boyutları ayrı ölçülür.
// Staging'de https://staging.firmaxi.com/lab/ altında yayınlanır (telefonla ölçüm için).
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/lab/' : '/',
  server: { port: 5175, strictPort: true, host: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        babylon: resolve(import.meta.dirname, 'babylon.html'),
        three: resolve(import.meta.dirname, 'three.html'),
      },
    },
  },
}));
