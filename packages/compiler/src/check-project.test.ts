/**
 * `check` against realistic projects: tsconfig discovery, plain-JS and
 * TypeScript components, template-only bindings, type-only imports, broken
 * configs and malformed components.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { check } from '@/check';

// each case builds a whole TypeScript program; the first loads the lib files cold.
vi.setConfig({ testTimeout: 30_000 });
import { toScriptText } from '@/script-text';

const EXT = 'utopia';
let dir = '';

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** A temp project: a tsconfig plus `files` (path → content) under it. */
function project(
  compilerOptions: Record<string, unknown>,
  files: Record<string, string>,
  extra: Record<string, unknown> = {},
): string {
  dir = mkdtempSync(join(tmpdir(), 'utopia-check-project-'));
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'bundler',
        noEmit: true,
        skipLibCheck: true,
        ...compilerOptions,
      },
      include: ['src/**/*'],
      ...extra,
    }),
  );
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return join(dir, 'tsconfig.json');
}

const run = (config: string) => check(ts, config, [], { pretty: false });

describe('check — discovery', () => {
  it('finds components through the tsconfig include, wherever they live', () => {
    const config = project(
      {},
      {
        [`src/pages/Home.${EXT}`]:
          '<template><p>x</p></template><script lang="ts">const n: number = "s";</script>',
      },
    );
    const result = run(config);
    expect(result.fileCount).toBe(1);
    expect(result.errorCount).toBe(1);
  });

  it('leaves out components the tsconfig excludes', () => {
    const config = project(
      {},
      {
        'src/index.ts': 'export const ok = 1;\n',
        [`src/fixtures/Broken.${EXT}`]: '<script lang="ts">const n: number = "s";</script>',
      },
      { exclude: ['src/fixtures'] },
    );
    expect(run(config).errorCount).toBe(0);
  });
});

describe('check — plain JavaScript components', () => {
  it('does not apply strict TypeScript rules to a component without lang="ts"', () => {
    const config = project(
      {},
      {
        [`src/Legacy.${EXT}`]:
          '<template><button @click="onClick">x</button></template>\n<script>\nfunction onClick(e) { return e; }\n</script>',
      },
    );
    expect(run(config).errorCount).toBe(0);
  });

  it('checks it under checkJs, as tsc does a .js file', () => {
    const config = project(
      { checkJs: true, allowJs: true },
      {
        [`src/Legacy.${EXT}`]: '<script>\nconst n = 1;\nn.toUpperCase();\n</script>',
      },
    );
    expect(run(config).errorCount).toBeGreaterThan(0);
  });
});

describe('check — template-only bindings', () => {
  it('does not report a binding the template uses as unused', () => {
    const config = project(
      { noUnusedLocals: true },
      {
        [`src/Row.${EXT}`]: '<template><li>row</li></template>',
        [`src/List.${EXT}`]:
          '<template><ul><Row /><p>{{ v }}</p></ul></template>\n<script lang="ts">\nimport Row from \'./Row.utopia\';\nconst v = 1;\n</script>',
      },
    );
    expect(run(config).diagnostics.join('')).not.toContain('never read');
  });

  it('still reports a binding nothing uses', () => {
    const config = project(
      { noUnusedLocals: true },
      {
        [`src/A.${EXT}`]:
          '<template><p>x</p></template>\n<script lang="ts">\nconst unused = 1;\n</script>',
      },
    );
    expect(run(config).diagnostics.join('')).toContain(
      "'unused' is declared but its value is never read",
    );
  });
});

describe('check — type-only imports the compiler would ship', () => {
  it('reports a type imported without `type`', () => {
    const config = project(
      {},
      {
        'src/types.ts': 'export interface Props { id: string }\n',
        [`src/A.${EXT}`]:
          "<template><p>x</p></template>\n<script lang=\"ts\">\nimport { Props } from './types';\nconst p: Props = { id: 'a' };\n</script>",
      },
    );
    const out = run(config);
    expect(out.errorCount).toBeGreaterThan(0);
    expect(out.diagnostics.join('')).toContain('type-only import');
  });

  it('accepts `import type`', () => {
    const config = project(
      {},
      {
        'src/types.ts': 'export interface Props { id: string }\n',
        [`src/A.${EXT}`]:
          "<template><p>{{ p.id }}</p></template>\n<script lang=\"ts\">\nimport type { Props } from './types';\nconst p: Props = { id: 'a' };\n</script>",
      },
    );
    expect(run(config).errorCount).toBe(0);
  });
});

describe('check — errors that must not pass silently', () => {
  it('reports a tsconfig that extends a missing file', () => {
    const config = project({}, {}, { extends: './missing.json' });
    const out = run(config);
    expect(out.errorCount).toBeGreaterThan(0);
  });

  it('reports a malformed component instead of crashing', () => {
    const config = project(
      {},
      {
        [`src/Broken.${EXT}`]: '<template><p>x</p></template><script lang="ts">const a = 1;',
        [`src/Fine.${EXT}`]: '<script lang="ts">const n: number = "s";</script>',
      },
    );
    const out = run(config);
    expect(out.diagnostics.join('')).toContain('Unclosed <script>');
    // the rest of the project is still checked
    expect(out.diagnostics.join('')).toContain('Fine.utopia');
  });

  it('writes plain text when not pretty', () => {
    const config = project(
      {},
      { [`src/A.${EXT}`]: '<script lang="ts">const n: number = "s";</script>' },
    );
    // eslint-disable-next-line no-control-regex
    expect(run(config).diagnostics.join('')).not.toMatch(/\u001b\[/);
  });
});

describe('toScriptText — offsets with astral characters', () => {
  it('keeps the length and line of every script line after an emoji', () => {
    const source =
      '<template>\n  <p>🎉</p>\n</template>\n<script lang="ts">\nconst x = 1;\n</script>\n';
    const text = toScriptText(source);
    expect(text.length).toBe(source.length);
    expect(text.indexOf('const x')).toBe(source.indexOf('const x'));
  });
});
