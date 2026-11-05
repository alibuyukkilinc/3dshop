/**
 * Backend modül bağımlılık grafiği (Cortex moduller/B3, K51). modül -> bağımlı olabileceği modüller.
 * Tablo dışı her yön yasaktır; yeni modül önce buraya ve Cortex'e yazılır.
 */
const KERNEL = ['platform', 'audit', 'identity'];

module.exports = {
  platform: [],
  audit: ['platform'],
  identity: ['platform', 'audit'],
  // Operasyon: hata kaydı, uyarılar, yedek durumu (F0.7). Hiçbir domain modülü ops'a bağımlı olmaz.
  ops: [...KERNEL],
  commerce: [...KERNEL],
  world: [...KERNEL],
  assets: [...KERNEL],
  catalog: [...KERNEL, 'commerce'],
  integration: [...KERNEL, 'catalog', 'commerce'],
  rules: [...KERNEL, 'catalog', 'commerce', 'world', 'assets'],
  scene: [...KERNEL, 'assets', 'world'],
  placement: [...KERNEL, 'rules', 'catalog', 'scene'],
  publishing: [...KERNEL],
  delivery: [...KERNEL, 'scene', 'placement', 'rules', 'assets', 'world', 'catalog'],
  discovery: [...KERNEL, 'catalog', 'commerce', 'world', 'rules'],
  analytics: [...KERNEL],
  seo: [...KERNEL, 'catalog', 'commerce', 'world', 'rules'],
};
