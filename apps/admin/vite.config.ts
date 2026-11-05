import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Yönetim paneli (K49). Geliştirmede /api istekleri yerel API'ye (3100) aktarılır; tarayıcı tek kaynak görür,
// oturum çerezi (Path=/api/admin, SameSite=Strict) çalışır.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.ADMIN_PORT ?? 5174),
    strictPort: true,
    proxy: { '/api': apiTarget },
  },
});
