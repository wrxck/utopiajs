import { describe, expect, it } from 'vitest';

import { compileScript, needsTranspile } from '@/script-compiler';

describe('needsTranspile', () => {
  it('leaves a component with no lang alone', () => {
    expect(needsTranspile(undefined)).toBe(false);
    expect(needsTranspile('js')).toBe(false);
  });

  it('transpiles both spellings of typescript', () => {
    expect(needsTranspile('ts')).toBe(true);
    expect(needsTranspile('typescript')).toBe(true);
  });
});

describe('compileScript', () => {
  const file = '/x/Comp.utopia';

  it('returns a plain script byte-for-byte', () => {
    const src = 'const a = 1;\nexport const b = a + 1;\n';
    expect(compileScript(src, undefined, file)).toBe(src);
  });

  it('strips type annotations', () => {
    const out = compileScript('const n: number = 1;\n', 'ts', file);
    expect(out).toContain('const n = 1');
    expect(out).not.toContain(': number');
  });

  it('strips an interface entirely', () => {
    const out = compileScript('interface P { a: string }\nconst p = 1;\n', 'ts', file);
    expect(out).not.toContain('interface');
    expect(out).toContain('const p = 1');
  });

  it('keeps module syntax so the bundler still sees the imports', () => {
    const out = compileScript("import { x } from '@/lib/x';\nexport const y = x;\n", 'ts', file);
    expect(out).toContain("import { x } from '@/lib/x'");
    expect(out).toContain('export const y');
  });

  it('keeps an import whose binding the script never mentions', () => {
    const out = compileScript("import { t } from '@/lib/i18n';\nexport const v = 1;\n", 'ts', file);
    expect(out).toContain("import { t } from '@/lib/i18n'");
  });

  it('keeps a child component import, which only the template ever names', () => {
    const out = compileScript(
      "import Row from '@/components/Row/Row.utopia';\nexport const v = 1;\n",
      'ts',
      file,
    );
    expect(out).toContain("import Row from '@/components/Row/Row.utopia'");
  });

  it('elides an import used only as a type', () => {
    const out = compileScript(
      "import type { T } from '@/lib/t';\nexport const v: T = 1;\n",
      'ts',
      file,
    );
    expect(out).not.toContain('@/lib/t');
  });

  it('refuses a lang it does not support rather than emitting it raw', () => {
    expect(() => compileScript('x', 'coffee', file)).toThrow(/unsupported <script lang="coffee">/);
  });

  it('names the supported values in the refusal', () => {
    expect(() => compileScript('x', 'coffee', file)).toThrow(/js, javascript, ts, typescript/);
  });

  it('degrades a const enum to a real enum rather than inlining it', () => {
    // typescript's documented isolatedModules behaviour. it cannot inline the
    // members without the whole program, so it emits a runtime enum instead.
    // the members still resolve, which is what matters here.
    const out = compileScript('const enum E { A }\nexport const v = E.A;\n', 'ts', file);
    expect(out).toContain('E[E["A"] = 0]');
  });

  it('still compiles a script that imports nothing', () => {
    const out = compileScript('const n: number = 1;\n', 'ts', file);
    expect(out).toContain('const n = 1');
  });
});
