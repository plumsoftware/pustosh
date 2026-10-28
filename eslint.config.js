import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist*/**',
      'android/**',
      'public/**',
      'art/**',
      '_legacy_korge/**',
      'Pustosh_GameDev_Package*/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  // src/core — чистый TypeScript: без Phaser, без браузера, без системного времени и Math.random.
  {
    files: ['src/core/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'phaser', message: 'src/core не должен зависеть от Phaser.' }],
          patterns: [
            { group: ['phaser/*'], message: 'src/core не должен зависеть от Phaser.' },
            { group: ['**/game/**', '**/platform/**'], message: 'src/core не импортирует game и platform.' },
            { group: ['@capacitor/*'], message: 'src/core не зависит от Capacitor.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core не знает про браузер.' },
        { name: 'document', message: 'src/core не знает про браузер.' },
        { name: 'localStorage', message: 'src/core не знает про браузер.' },
        { name: 'navigator', message: 'src/core не знает про браузер.' },
        { name: 'performance', message: 'Время в core — только тики GameClock.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Время в core — только тики GameClock.' },
        { object: 'Math', property: 'random', message: 'Используйте RNG по сиду (util/rng).' },
        { object: 'performance', property: 'now', message: 'Время в core — только тики GameClock.' },
      ],
    },
  },
);
