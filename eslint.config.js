import js from '@eslint/js';
import utopia from '@matthesketh/eslint-plugin-utopia';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...utopia.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      // organise imports into groups: side-effect, node builtins, external
      // packages, alias (@/), then relative — matching the codebase convention.
      'simple-import-sort/imports': [
        'error',
        {
          groups: [['^\\u0000'], ['^node:'], ['^@?\\w'], ['^@/'], ['^\\.']],
        },
      ],
      'simple-import-sort/exports': 'error',
    },
  },
  {
    files: ['packages/*/src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/template/**'],
  },
];
