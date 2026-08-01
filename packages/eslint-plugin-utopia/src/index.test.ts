// @vitest-environment node
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

import plugin, { parser } from './index';

describe('plugin object', () => {
  it('exposes meta, rules and the recommended config', () => {
    expect(plugin.meta.name).toBe('@matthesketh/eslint-plugin-utopia');
    expect(plugin.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(plugin.rules).sort()).toEqual([
      'no-tdz-effect-read',
      'no-undecoded-entities',
      'no-untracked-global-listener',
    ]);
    expect(Array.isArray(plugin.configs.recommended)).toBe(true);
  });

  it('recommended config targets .utopia files with the bundled parser', () => {
    const [config] = plugin.configs.recommended as Array<Record<string, any>>;
    expect(config.name).toBe('utopia/recommended');
    expect(config.files).toEqual(['**/*.utopia']);
    expect(config.languageOptions.parser).toBe(parser);
    // the plugin references itself so flat config consumers can spread it.
    expect(config.plugins.utopia).toBe(plugin);
    expect(config.rules['utopia/no-undecoded-entities']).toBe('error');
    // template bindings are invisible to eslint; these core rules must be off.
    expect(config.rules['no-undef']).toBe('off');
    expect(config.rules['no-unused-vars']).toBe('off');
  });

  it('lints a .utopia component end-to-end through the recommended config', () => {
    const linter = new Linter();
    const messages = linter.verify(
      '<template><p>5 &minus; 3</p></template>\n<script>const a: number = 1;\n</script>',
      plugin.configs.recommended as never,
      'component.utopia',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe('utopia/no-undecoded-entities');
  });
});
