import js from '@eslint/js';
import utopia from '@matthesketh/eslint-plugin-utopia';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

// organise imports into groups: side-effect, node builtins, external
// packages, alias (@/), then relative — matching the codebase convention.
const importSortRules = {
  'simple-import-sort/imports': [
    'error',
    {
      groups: [['^\\u0000'], ['^node:'], ['^@?\\w'], ['^@/'], ['^\\.']],
    },
  ],
  'simple-import-sort/exports': 'error',
};

export default [
  js.configs.recommended,
  ...utopia.configs.recommended,
  {
    // plain scripts: the dev servers shipped with the example and the scaffold
    // template, and this config itself. all node, all esm.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: importSortRules,
  },
  {
    // every TypeScript file in the repo, not just package sources: build and
    // test config, the example app, and the create-utopia template are all
    // shipped or executed code and drift the moment they stop being linted.
    files: ['**/*.ts'],
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
      ...importSortRules,
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // the docs site is a separate, gitignored checkout — not part of this repo.
      'utopia-docs/**',
    ],
  },
];
