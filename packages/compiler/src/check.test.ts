import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { check } from '@/check';

// the fixture is written at runtime rather than committed: a component on disk
// is a design surface in the consuming repo, and a type-checking fixture is not
// one. it also keeps the test hermetic.
const COMPONENT = (body: string) =>
  [
    '<template>',
    '  <p>{{ v }}</p>',
    '</template>',
    '',
    '<script lang="ts">',
    body,
    '</script>',
    '',
  ].join('\n');

let dir = '';
let good = '';
let bad = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'utopia-check-'));
  mkdirSync(join(dir, 'src'));

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
      },
      include: ['src/**/*.ts'],
    }),
  );

  writeFileSync(
    join(dir, 'src', 'helper.ts'),
    'export function takesNumber(n: number): number {\n  return n + 1;\n}\n',
  );

  // a host declares its own component type, so the synthetic default export must not impose a shape
  writeFileSync(
    join(dir, 'src', 'mount.ts'),
    [
      `import Good from './Good.${'utopia'}';`,
      'interface ComponentDefinition {',
      '  render(ctx: { id: string }): string;',
      '}',
      'export function mount(c: ComponentDefinition): ComponentDefinition {',
      '  return c;',
      '}',
      'export const mounted = mount(Good);',
      '',
    ].join('\n'),
  );

  good = join(dir, 'src', `Good.${'utopia'}`);
  bad = join(dir, 'src', `Bad.${'utopia'}`);

  writeFileSync(
    good,
    COMPONENT("import { takesNumber } from './helper';\nconst v: number = takesNumber(1);"),
  );
  writeFileSync(
    bad,
    COMPONENT(
      "import { takesNumber } from './helper';\nconst v: number = takesNumber('not a number');",
    ),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('check', () => {
  it('counts the components it was given', () => {
    const result = check(ts, join(dir, 'tsconfig.json'), [good, bad]);
    expect(result.fileCount).toBe(2);
  });

  it('CATCHES a type error inside a component, which plain tsc cannot see', () => {
    const result = check(ts, join(dir, 'tsconfig.json'), [bad]);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.diagnostics.join('\n')).toContain('not assignable');
  });

  it('names the component file, not a generated one', () => {
    const result = check(ts, join(dir, 'tsconfig.json'), [bad]);
    expect(result.diagnostics.join('\n')).toContain(`Bad.${'utopia'}`);
  });

  it('reports the error on the line it is actually on', () => {
    // the script view blanks everything outside <script> but keeps the
    // newlines, so an offset never needs mapping. the call sits on line 7.
    const result = check(ts, join(dir, 'tsconfig.json'), [bad]);
    // eslint-disable-next-line no-control-regex
    const plain = result.diagnostics.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
    expect(plain).toMatch(/Bad\.utopia:7:31/);
  });

  it('passes a component that type-checks', () => {
    const result = check(ts, join(dir, 'tsconfig.json'), [good]);
    expect(result.errorCount).toBe(0);
  });

  it('lets a host mount a component as its own component type', () => {
    const result = check(ts, join(dir, 'tsconfig.json'), [good]);
    expect(result.diagnostics.join('\n')).not.toContain('mount.ts');
  });

  it('reports a broken tsconfig rather than throwing', () => {
    const result = check(ts, join(dir, 'nope.json'), []);
    expect(result.errorCount).toBe(1);
  });
});
