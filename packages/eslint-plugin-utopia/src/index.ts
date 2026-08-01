// @matthesketh/eslint-plugin-utopia — eslint parser + rules for .utopia
// single-file components. consumers spread `configs.recommended` into their
// flat config; see the package readme for a worked example.

import * as parser from '@/parser';
import noTdzEffectRead from '@/rules/no-tdz-effect-read';
import noUndecodedEntities from '@/rules/no-undecoded-entities';
import noUntrackedGlobalListener from '@/rules/no-untracked-global-listener';

const meta = { name: '@matthesketh/eslint-plugin-utopia', version: '0.12.0' };

const rules = {
  'no-tdz-effect-read': noTdzEffectRead,
  'no-undecoded-entities': noUndecodedEntities,
  'no-untracked-global-listener': noUntrackedGlobalListener,
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
      'utopia/no-tdz-effect-read': 'error',
      'utopia/no-undecoded-entities': 'error',
      'utopia/no-untracked-global-listener': 'error',
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
