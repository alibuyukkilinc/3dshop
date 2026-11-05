import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '.cortex/**',
      '.claude/**',
      'apps/api/src/generated/**',
      'packages/config/test/fixtures/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // Para float ile tutulmaz (Cortex K33): bigint kuruş.
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Para için float yasak (K33). Kuruş bigint kullan.' },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // NestJS DI, constructor parametre tiplerini çalışma anında kullanır; "import type" DI'ı bozar.
    files: ['apps/api/src/**/*.ts', 'apps/api/test/**/*.ts', 'apps/api/scripts/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
);
