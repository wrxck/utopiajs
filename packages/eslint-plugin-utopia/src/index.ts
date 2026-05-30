// @matthesketh/eslint-plugin-utopia — eslint parser + rules for .utopia
// single-file components. consumers spread `configs.recommended` into their
// flat config; see the package readme for a worked example.

import * as parser from './parser';
import noUndecodedEntities from './rules/no-undecoded-entities';

const meta = { name: '@matthesketh/eslint-plugin-utopia', version: '0.8.1' };

const rules = {
  'no-undecoded-entities': noUndecodedEntities,
} as const;

// assembled after declaration so the recommended config can reference the
// plugin object itself (flat config requires the plugin in `plugins`).
const plugin: {
  meta: typeof meta;
  rules: typeof rules;
  configs: Record<string, unknown>;
} = { meta, rules, configs: {} };

plugin.configs.recommended = [
  {
    name: 'utopia/recommended',
    files: ['**/*.utopia'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { utopia: plugin },
    rules: {
      'utopia/no-undecoded-entities': 'error',
      // the parser masks everything outside <script>, so eslint cannot see that
      // a binding is referenced from the template ({{ }} or a directive). these
      // two core rules would therefore report false positives; the typescript
      // compiler already reports genuinely undefined names and unused locals.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
];

export { parser };
export default plugin;
