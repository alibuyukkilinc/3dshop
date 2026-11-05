/**
 * pm2 süreçleri (K54): dtd kullanıcısı altında, Finans ve Cortex'ten ayrı. Bellek sınırları kaynak paylaşımı için.
 * Ortam değişkenleri depo kökündeki .env'den okunur (sunucuda dtd kullanıcısına ait, 600).
 */
const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'dtd-api',
      cwd: `${root}/apps/api`,
      script: 'dist/main.js',
      node_args: `--enable-source-maps --env-file=${root}/.env`,
      max_memory_restart: '1G',
      kill_timeout: 10000,
    },
    {
      name: 'dtd-worker',
      cwd: `${root}/apps/api`,
      script: 'dist/worker.js',
      node_args: `--enable-source-maps --env-file=${root}/.env`,
      max_memory_restart: '1G',
      kill_timeout: 15000,
    },
    {
      name: 'dtd-web',
      cwd: `${root}/apps/web`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start --port 3101 --hostname 127.0.0.1',
      node_args: `--env-file=${root}/.env`,
      max_memory_restart: '768M',
    },
  ],
};
