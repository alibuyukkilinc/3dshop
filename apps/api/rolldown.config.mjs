import swc from 'unplugin-swc';
import { defineConfig } from 'rolldown';

/**
 * Üretim derlemesi: api ve worker giriş noktaları dist/'e paketlenir.
 * TypeScript SWC ile derlenir (NestJS decorator metadata'sı). Yalnız proje kodu ve @dtd/* paketleri pakete girer;
 * npm bağımlılıkları çalışma anında node_modules'tan yüklenir.
 */
const isBundled = (id) =>
  id.startsWith('.') || id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id) || id.startsWith('@dtd/');

export default defineConfig({
  input: { main: 'src/main.ts', worker: 'src/worker.ts' },
  platform: 'node',
  external: (id) => !isBundled(id),
  plugins: [
    swc.rolldown({
      tsconfigFile: false,
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
      },
      module: { type: 'es6' },
    }),
  ],
  output: {
    dir: 'dist',
    format: 'esm',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    sourcemap: true,
    cleanDir: true,
  },
});
