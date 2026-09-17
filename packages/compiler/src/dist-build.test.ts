import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// the source tests all import from src, so nothing here sees what tsup emits.
// the cjs build once threw on require because import.meta.url shimmed to
// undefined, and every source test stayed green.
describe.runIf(existsSync(join(dist, 'index.cjs')))('the built cjs bundle', () => {
  it('loads without throwing', () => {
    expect(() => require(join(dist, 'index.cjs'))).not.toThrow();
  });

  it('exposes compile and transpiles a typescript script through it', () => {
    const m = require(join(dist, 'index.cjs')) as typeof import('./index.js');
    const out = m.compile(
      '<template><p>x</p></template>\n<script lang="ts">const n: number = 1;\n</script>\n',
      {
        filename: '/tmp/x.utopia',
      },
    );
    expect(out.code).toContain('const n = 1');
  });

  it('exposes check, which a host runs to type-check its components', () => {
    const m = require(join(dist, 'index.cjs')) as typeof import('./index.js');
    expect(typeof m.check).toBe('function');
  });
});

describe.runIf(existsSync(join(dist, 'index.js')))('the built esm bundle', () => {
  it('loads and transpiles a typescript script', async () => {
    const m = (await import(join(dist, 'index.js'))) as typeof import('./index.js');
    const out = m.compile(
      '<template><p>x</p></template>\n<script lang="ts">const n: number = 1;\n</script>\n',
      {
        filename: '/tmp/x.utopia',
      },
    );
    expect(out.code).toContain('const n = 1');
  });
});
