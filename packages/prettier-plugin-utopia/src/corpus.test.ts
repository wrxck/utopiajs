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

// a canonical form for a block, so before and after can be compared byte for
// byte. two things otherwise make prettier's output depend on how its input was
// laid out rather than on what the input says, and both produce false alarms:
//
//   objectWrap defaults to 'preserve', which keeps an object expanded when the
//   source had a newline after `{`; and the plugin lays every block one tab stop
//   in, so it has that much less width than the same text formatted on its own.
//
// pin both and the comparison is exact — no whitespace-insensitive fallback,
// which would have hidden a block losing its indentation-significant content.
const canonical = (source: string, parser: string): Promise<string> =>
  prettier.format(source, {
    parser,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 100 - 2,
    tabWidth: 2,
    objectWrap: 'collapse',
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

      // nothing may vanish: each block, reduced to its canonical form, must be
      // byte-identical before and after. this is the check that catches a block
      // quietly losing its opening lines — the damage there stays valid
      // TypeScript, keeps the same block set and barely changes the file size,
      // so nothing coarser notices it.
      for (const name of blockNames) {
        if (!before[name]) continue;
        const parser = subParser(name, before[name]!.attrs);
        let expected: string;
        try {
          expected = await canonical(before[name]!.content, parser);
        } catch {
          continue; // the sub-formatter cannot read the original: nothing to compare
        }
        const actual = await canonical(after[name]!.content, parser);
        expect(actual).toBe(expected);
      }
    });
  }
});

// a check that only ever runs against clean input cannot tell you it still
// works. this pins the sensitivity of the one above against the damage the
// splitter used to cause, and shows why the coarser checks are not enough.
describe('the corpus check notices a block losing its opening lines', () => {
  const intact = [
    '<script>',
    "import { signal, effect } from '@matthesketh/utopia-core';",
    "import { currentRoute } from '@matthesketh/utopia-router';",
    '',
    '// the client bundle inlines every route module, so this <script> is',
    '// evaluated at app boot on every load, not when the route renders.',
    "const status = signal('idle');",
    '</script>',
  ].join('\n');

  // what the splitter used to emit: everything up to the comment's own `<script>`
  // token is gone, and the tail of that comment line is left as a bare statement.
  const damaged = ['<script>', 'is;', "const status = signal('idle');", '</script>'].join('\n');

  const script = (component: string) => parse(component, 'x').script!.content;

  it('survives the checks that are too coarse to see it', () => {
    // still the same blocks, with the same attributes.
    expect(shape(parse(damaged, 'x'))).toEqual(shape(parse(intact, 'x')));
    // and the wreckage is still valid TypeScript, so a build stays green.
    expect(() => prettier.format(script(damaged), { parser: 'typescript' })).not.toThrow();
  });

  it('is caught by the canonical block comparison', async () => {
    const expected = await canonical(script(intact), 'typescript');
    const actual = await canonical(script(damaged), 'typescript');
    expect(actual).not.toBe(expected);
  });
});
