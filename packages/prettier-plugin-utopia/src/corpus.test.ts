// every .utopia component in the repository, run through the formatter for real.
//
// unit tests pin behaviour on hand-written snippets; this pins it on the actual
// corpus, which is where the interesting shapes live (escaped closing tags in
// template literals, <pre> samples, nested elements). three guarantees:
//
//   1. idempotence   — formatting twice produces the same bytes as once.
//   2. still parses  — the real compiler accepts the formatted output.
//   3. blocks intact — the same blocks with the same attributes survive.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, type SFCDescriptor } from '@matthesketh/utopia-compiler';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import plugin from '@/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'utopia-docs', 'coverage']);

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith('.utopia')) out.push(full);
  }
  return out;
}

const files = collect(root).sort();

const format = (source: string): Promise<string> =>
  prettier.format(source, {
    parser: 'utopia',
    plugins: [plugin],
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
    tabWidth: 2,
  });

const blockNames = ['template', 'script', 'style', 'test'] as const;

const shape = (descriptor: SFCDescriptor) =>
  blockNames
    .filter((name) => descriptor[name])
    .map((name) => `${name}:${JSON.stringify(descriptor[name]!.attrs)}`);

function subParser(
  name: (typeof blockNames)[number],
  attrs: Record<string, string | true>,
): string {
  if (name === 'template') return 'html';
  if (name !== 'style') return 'typescript';
  const lang = attrs.lang;
  if (lang === 'scss') return 'scss';
  if (lang === 'less') return 'less';
  return 'css';
}

const subFormat = (source: string, parser: string): Promise<string> =>
  prettier.format(source, {
    parser,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100,
    tabWidth: 2,
  });

describe('.utopia corpus', () => {
  it('finds the components to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(root, file);

    it(`formats ${rel} losslessly and idempotently`, async () => {
      const source = readFileSync(file, 'utf8');
      const once = await format(source);
      const twice = await format(once);

      expect(twice).toBe(once);

      const before = parse(source, rel);
      const after = parse(once, rel);
      expect(shape(after)).toEqual(shape(before));

      // nothing may vanish: each block, put through prettier's own sub-formatter,
      // must carry the same content afterwards. whitespace is compared loosely
      // because a block is laid out one tab stop in, so prose and long
      // expressions can wrap at a different column than they would standalone.
      for (const name of blockNames) {
        if (!before[name]) continue;
        const parser = subParser(name, before[name]!.attrs);
        let expected: string;
        try {
          expected = await subFormat(before[name]!.content, parser);
        } catch {
          continue; // the sub-formatter cannot read the original: nothing to compare
        }
        const actual = await subFormat(after[name]!.content, parser);
        expect(actual.replace(/\s+/g, '')).toBe(expected.replace(/\s+/g, ''));
      }
    });
  }
});
