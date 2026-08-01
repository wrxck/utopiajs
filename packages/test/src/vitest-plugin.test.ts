// @vitest-environment node
// ============================================================================
// @matthesketh/utopia-test/plugin — Test suite (real FS in a temp dir)
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { utopiaTestPlugin } from './vitest-plugin';

/** Loosely-typed view of a plugin hook so tests can invoke it directly. */
type AnyHook = (this: unknown, ...args: any[]) => any;

const SCRATCH = process.env.CLAUDE_SCRATCHPAD ?? os.tmpdir();

const WITH_TEST = `<template><p>hi</p></template>

<test>
describe('x', () => { it('works', () => { expect(1).toBe(1); }); });
</test>
`;

const WITHOUT_TEST = `<template><p>hi</p></template>
`;

const UNPARSEABLE = `<template><p>hi</p>`;

let tmpDir: string;
let srcDir: string;
let originalVitestEnv: string | undefined;

beforeEach(() => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(SCRATCH, 'vitest-plugin-'));
  srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  originalVitestEnv = process.env.VITEST;
});

afterEach(() => {
  if (originalVitestEnv === undefined) delete process.env.VITEST;
  else process.env.VITEST = originalVitestEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(relative: string, content: string): string {
  const file = path.join(tmpDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

function buildStart(plugin: ReturnType<typeof utopiaTestPlugin>): void {
  (plugin.buildStart as unknown as AnyHook).call({});
}

function buildEnd(plugin: ReturnType<typeof utopiaTestPlugin>): void {
  (plugin.buildEnd as unknown as AnyHook).call({});
}

function hotUpdate(plugin: ReturnType<typeof utopiaTestPlugin>, file: string): void {
  (plugin.handleHotUpdate as unknown as AnyHook).call({}, { file });
}

describe('utopiaTestPlugin', () => {
  it('has the correct name', () => {
    expect(utopiaTestPlugin().name).toBe('utopia-test');
  });

  it('generates companion test files for .utopia files with <test> blocks', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);

    const testFile = component + '.test.ts';
    expect(fs.existsSync(testFile)).toBe(true);
    const content = fs.readFileSync(testFile, 'utf-8');
    expect(content).toContain(`import self from './Counter.utopia';`);
    expect(content).toContain("describe('x'");
    expect(content).toContain('Auto-generated from Counter.utopia');
  });

  it('recurses into subdirectories but skips node_modules and dist', () => {
    write('src/nested/Deep.utopia', WITH_TEST);
    write('src/node_modules/Dep.utopia', WITH_TEST);
    write('src/dist/Out.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);

    expect(fs.existsSync(path.join(srcDir, 'nested', 'Deep.utopia.test.ts'))).toBe(true);
    expect(fs.existsSync(path.join(srcDir, 'node_modules', 'Dep.utopia.test.ts'))).toBe(false);
    expect(fs.existsSync(path.join(srcDir, 'dist', 'Out.utopia.test.ts'))).toBe(false);
  });

  it('skips files without a <test> block and unparseable files', () => {
    const plain = write('src/Plain.utopia', WITHOUT_TEST);
    const broken = write('src/Broken.utopia', UNPARSEABLE);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);

    expect(fs.existsSync(plain + '.test.ts')).toBe(false);
    expect(fs.existsSync(broken + '.test.ts')).toBe(false);
  });

  it('does nothing outside a vitest run (VITEST unset)', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    delete process.env.VITEST;

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);

    expect(fs.existsSync(component + '.test.ts')).toBe(false);
  });

  it('resolves relative include directories against cwd', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const cwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const plugin = utopiaTestPlugin({ include: ['src'] });
      buildStart(plugin);
    } finally {
      process.chdir(cwd);
    }

    expect(fs.existsSync(component + '.test.ts')).toBe(true);
  });

  it('ignores missing include directories', () => {
    process.env.VITEST = 'true';
    const plugin = utopiaTestPlugin({ include: [path.join(tmpDir, 'does-not-exist')] });
    expect(() => buildStart(plugin)).not.toThrow();
  });

  it('cleans up generated files on buildEnd', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);
    expect(fs.existsSync(component + '.test.ts')).toBe(true);

    buildEnd(plugin);
    expect(fs.existsSync(component + '.test.ts')).toBe(false);
    // The source component is untouched.
    expect(fs.existsSync(component)).toBe(true);
  });

  it('keeps generated files when cleanup is disabled', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir], cleanup: false });
    buildStart(plugin);
    buildEnd(plugin);
    expect(fs.existsSync(component + '.test.ts')).toBe(true);
  });

  it('cleanup tolerates files already deleted by hand', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);
    fs.unlinkSync(component + '.test.ts');
    expect(() => buildEnd(plugin)).not.toThrow();
  });

  it('regenerates the companion file on hot update', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);

    fs.writeFileSync(component, WITH_TEST.replace("describe('x'", "describe('y'"), 'utf-8');
    hotUpdate(plugin, component);

    expect(fs.readFileSync(component + '.test.ts', 'utf-8')).toContain("describe('y'");
  });

  it('ignores non-utopia files on hot update', () => {
    process.env.VITEST = 'true';
    const plugin = utopiaTestPlugin({ include: [srcDir] });
    const other = write('src/util.ts', 'export {}');
    expect(() => hotUpdate(plugin, other)).not.toThrow();
    expect(fs.existsSync(other + '.test.ts')).toBe(false);
  });

  it('removes the generated file when the <test> block is removed (bug fix)', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    process.env.VITEST = 'true';

    const plugin = utopiaTestPlugin({ include: [srcDir] });
    buildStart(plugin);
    expect(fs.existsSync(component + '.test.ts')).toBe(true);

    // Author deletes the <test> block; the stale generated test must go too,
    // otherwise vitest keeps running tests that no longer exist in source.
    fs.writeFileSync(component, WITHOUT_TEST, 'utf-8');
    hotUpdate(plugin, component);

    expect(fs.existsSync(component + '.test.ts')).toBe(false);
  });

  it('does not generate files on hot update outside a vitest run (bug fix)', () => {
    const component = write('src/Counter.utopia', WITH_TEST);
    delete process.env.VITEST;

    // `utopia dev` can end up with this plugin in the config; editing a
    // component must not litter the source tree with generated test files.
    const plugin = utopiaTestPlugin({ include: [srcDir] });
    hotUpdate(plugin, component);

    expect(fs.existsSync(component + '.test.ts')).toBe(false);
  });
});
