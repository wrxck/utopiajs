// @vitest-environment node
/**
 * `utopia check` against a project whose tsconfig does not reach every
 * component. It used to print "clean" having checked none of them.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkCommand, parseArgs } from './index';

let dir = '';

afterEach(() => {
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('utopia check', () => {
  it('warns about components the tsconfig does not include', { timeout: 60_000 }, () => {
    dir = mkdtempSync(join(tmpdir(), 'utopia-cli-check-'));
    mkdirSync(join(dir, 'src', 'routes'), { recursive: true });
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          moduleResolution: 'bundler',
          module: 'ESNext',
        },
        include: ['src/**/*.ts'],
      }),
    );
    writeFileSync(join(dir, 'src', 'main.ts'), 'export const ok = 1;\n');
    writeFileSync(join(dir, 'src', 'routes', '+page.utopia'), '<template><p>x</p></template>');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    checkCommand(parseArgs(['node', 'utopia', 'check', join(dir, 'tsconfig.json')]));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('1 component(s) are outside this tsconfig'),
    );
  });

  it(
    'does not warn about a component the tsconfig excludes on purpose',
    { timeout: 60_000 },
    () => {
      dir = mkdtempSync(join(tmpdir(), 'utopia-cli-check-'));
      mkdirSync(join(dir, 'src', 'fixtures'), { recursive: true });
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { noEmit: true, moduleResolution: 'bundler', module: 'ESNext' },
          include: ['src/**/*'],
          exclude: ['src/fixtures'],
        }),
      );
      writeFileSync(join(dir, 'src', 'main.ts'), 'export const ok = 1;\n');
      writeFileSync(join(dir, 'src', 'fixtures', 'Case.utopia'), '<template><p>x</p></template>');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      checkCommand(parseArgs(['node', 'utopia', 'check', join(dir, 'tsconfig.json')]));
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
