/**
 * Mimari kuralları. Cortex: moduller dalı (B3), kararlar K19, K32, K50, K51.
 *
 * - Bir backend modülü başka bir modüle yalnız onun public/ klasörü üzerinden erişir.
 * - Hangi modülün hangisine bağımlı olabileceği ALLOWED tablosundadır; tablo dışı her yön yasaktır.
 * - Yeni modül eklenince önce bu tabloya ve Cortex moduller dalına yazılır.
 * Yollar başa sabitlenmemiştir (^ yok): aynı kurallar test fixture'larında da çalışır.
 */
/** modül -> bağımlı olabileceği modüller (kendisi hariç). */
const ALLOWED = require('./module-graph.cjs');

const MODULES = 'apps/api/src/modules/';

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const forbidden = [
  {
    name: 'no-circular',
    severity: 'error',
    comment: 'Döngüsel bağımlılık yasak.',
    from: {},
    to: { circular: true },
  },
  {
    name: 'api-module-internal-access',
    severity: 'error',
    comment:
      'Bir backend modülü başka bir modüle yalnız public/ klasörü üzerinden erişir (K50). İç klasörler dışarıya kapalıdır.',
    from: { path: `${MODULES}([^/]+)/` },
    to: {
      path: `${MODULES}[^/]+/`,
      pathNot: [`${MODULES}$1/`, `${MODULES}[^/]+/public/`],
    },
  },
  {
    name: 'api-module-unknown',
    severity: 'error',
    comment: 'modules/ altındaki her klasör ALLOWED tablosunda tanımlı olmalı.',
    from: { path: MODULES, pathNot: [`${MODULES}(${Object.keys(ALLOWED).join('|')})/`] },
    to: {},
  },
  ...Object.entries(ALLOWED).map(([mod, deps]) => ({
    name: `api-module-direction-${mod}`,
    severity: 'error',
    comment: `${mod} yalnız şu modüllere bağımlı olabilir: ${deps.join(', ') || '(hiçbiri)'} (K51).`,
    from: { path: `${MODULES}${mod}/` },
    to: { path: MODULES, pathNot: [`${MODULES}(${[mod, ...deps].join('|')})/`] },
  })),
  {
    name: 'api-infra-no-modules',
    severity: 'error',
    comment: 'infra/ teknik altyapıdır (config, veritabanı bağlantısı, http). Domain modüllerine bağımlı olamaz.',
    from: { path: 'apps/api/src/infra/' },
    to: { path: MODULES },
  },
  {
    name: 'packages-no-apps',
    severity: 'error',
    comment: 'Paylaşılan paketler uygulamalara bağımlı olamaz.',
    from: { path: 'packages/' },
    to: { path: 'apps/' },
  },
  {
    name: 'apps-no-cross-app',
    severity: 'error',
    comment: 'Bir uygulama başka bir uygulamanın kodunu import edemez; ortak şey packages/ içine gider.',
    from: { path: 'apps/([^/]+)/' },
    to: { path: 'apps/[^/]+/', pathNot: ['apps/$1/'] },
  },
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden,
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['node_modules', 'dist', '\\.next', 'src/generated', 'test/fixtures'] },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};
