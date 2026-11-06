import { config } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Yerelde .env'den veritabanı adresleri okunur; CI'da ortam değişkenleri zaten tanımlıdır.
config({ path: '../../.env', quiet: true });

// NestJS decorator metadata'sı için SWC ile derlenir.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Her entegrasyon dosyası kendi geçici veritabanını açıp siler
    hookTimeout: 60_000,
    // Yerel ikili modüller (sharp/libvips) dönüştürülmeden Node ile yüklenir
    server: { deps: { external: ['sharp', /@img\/sharp/] } },
  },
});
