import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import plugin from '@/index';
import { splitBlocks } from '@/split-blocks';

function format(source: string): Promise<string> {
  return prettier.format(source, { parser: 'utopia', plugins: [plugin] });
}

describe('splitBlocks', () => {
  it('keeps blocks in source order and preserves raw attributes', () => {
    const root = splitBlocks(
      '<script lang="ts">const x = 1;</script>\n<template><p>hi</p></template>',
    );
    expect(root.blocks.map((b) => b.name)).toEqual(['script', 'template']);
    expect(root.blocks[0].rawAttrs).toBe('lang="ts"');
    expect(root.blocks[0].content).toBe('const x = 1;');
  });
});

describe('format', () => {
  it('formats the script block as typescript', async () => {
    const out = await format('<script lang="ts">const   x:number=1</script>');
    expect(out).toContain('const x: number = 1;');
  });

  it('formats the style block as css', async () => {
    const out = await format('<style>.a{color:red}</style>');
    expect(out).toContain('color: red;');
  });

  it('re-indents the template via the html formatter', async () => {
    const out = await format(
      '<template>\n<section>\n<header><h1>Title</h1></header>\n</section>\n</template>',
    );
    expect(out).toContain('  <section>');
    expect(out).toContain('    <header>');
  });

  it('preserves bespoke directive and interpolation syntax', async () => {
    const out = await format(
      '<template><button @click="go()" :disabled="busy()" u-if="ok()">{{ label() }}</button></template>',
    );
    expect(out).toContain('@click="go()"');
    expect(out).toContain(':disabled="busy()"');
    expect(out).toContain('u-if="ok()"');
    expect(out).toContain('{{ label() }}');
  });

  it('keeps the author block order and separates blocks with a blank line', async () => {
    const out = await format(
      '<script>const a = 1;</script>\n<template><p>x</p></template>\n<style>.a{color:red}</style>',
    );
    expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('<template>'));
    expect(out.indexOf('<template>')).toBeLessThan(out.indexOf('<style>'));
    expect(out).toContain('</script>\n\n<template>');
  });

  it('is idempotent', async () => {
    const messy =
      '<template>\n<div  ><p>{{x()}}</p></div>\n</template>\n<script>const   y=2</script>';
    const once = await format(messy);
    const twice = await format(once);
    expect(twice).toBe(once);
  });

  it('leaves an unparseable script block untouched rather than failing', async () => {
    const out = await format('<script>this is (((not js</script>');
    expect(out).toContain('this is (((not js');
  });

  it('collapses an empty block onto a single line', async () => {
    const out = await format('<style></style>');
    expect(out.trim()).toBe('<style></style>');
  });

  it('formats scss and less style blocks with the matching sub-parser', async () => {
    const scss = await format('<style lang="scss">.a{.b{color:red}}</style>');
    expect(scss).toContain('.a {');
    expect(scss).toContain('.b {');

    const less = await format('<style lang="less">@c:red;.a{color:@c}</style>');
    expect(less).toContain('@c: red;');
  });

  it('formats <test> blocks as typescript', async () => {
    const out = await format("<test>it('x',()=>{expect(1).toBe(1)})</test>");
    expect(out).toContain('it("x", () => {');
  });

  it('keeps every line of a script that embeds an escaped closing tag', async () => {
    const source = [
      '<script>',
      'const sample = `<script>inner<\\/script>`;',
      'const keep = 1;',
      '</script>',
    ].join('\n');
    const out = await format(source);
    expect(out).toContain('const sample = `<script>inner<\\/script>`;');
    expect(out).toContain('const keep = 1;');
    expect(out.match(/<script>/g)).toHaveLength(2); // the block's own tag and the string's
  });

  it('keeps the imports above a comment that mentions a script tag', async () => {
    // the whole component, because the damage this guards against removed the
    // block's opening lines and left something that still compiled.
    const source = [
      '<script>',
      "import { signal, effect } from '@matthesketh/utopia-core';",
      "import { currentRoute } from '@matthesketh/utopia-router';",
      '',
      '// the client bundle inlines every route module, so this <script> is',
      '// evaluated at app boot on every load, not when the route renders.',
      "const status = signal('idle');",
      '</script>',
    ].join('\n');
    // the local format() helper takes prettier's defaults, hence double quotes.
    const out = await format(source);
    expect(out).toContain('import { signal, effect } from "@matthesketh/utopia-core";');
    expect(out).toContain('import { currentRoute } from "@matthesketh/utopia-router";');
    expect(out).toContain('const status = signal("idle");');
    expect(out).not.toContain('is;');
  });

  it('refuses a component it cannot split rather than emptying the file', async () => {
    await expect(format('<template><p>hi</p>')).rejects.toThrow(/Unclosed <template>/);
  });

  it('does not truncate a template containing a native <template> element', async () => {
    const out = await format(
      '<template>\n<div><template>inner</template></div>\n</template>\n<script>const a=1</script>',
    );
    expect(out).toContain('<template>inner</template>');
    expect(out).toContain('const a = 1;');
    // exactly one top-level template block remains.
    expect(out.match(/^<template>/gm)).toHaveLength(1);
  });
});

describe('plugin surface', () => {
  it('registers the utopia language for .utopia files', () => {
    expect(plugin.languages?.[0].extensions).toEqual(['.utopia']);
    expect(plugin.languages?.[0].parsers).toEqual(['utopia']);
  });

  it('locStart/locEnd report block offsets', () => {
    const root = splitBlocks('<script>const a = 1;</script>');
    const block = root.blocks[0];
    const parser = plugin.parsers!.utopia;
    expect(parser.locStart(block)).toBe(0);
    expect(parser.locEnd(block)).toBe('<script>const a = 1;</script>'.length);
  });

  it('the synchronous print fallback re-indents block contents', () => {
    const root = splitBlocks('<script lang="ts">  const a = 1;  </script>');
    const printer = plugin.printers!['utopia-ast'];
    const printed = printer.print(
      { node: root.blocks[0] } as never,
      {} as never,
      (() => '') as never,
    );
    expect(JSON.stringify(printed)).toContain('<script lang=\\"ts\\">');
    expect(JSON.stringify(printed)).toContain('const a = 1;');
    expect(JSON.stringify(printed)).toContain('</script>');
  });

  it('the printer refuses blocks that do not span the file it was given', () => {
    // stands in for a future splitter bug: blocks that look fine on their own but
    // leave real source stranded between them. the printer emits nothing but the
    // blocks, so without this the stranded text is deleted. checked against
    // prettier's own copy of the file, independently of what the parser saw.
    const original = [
      '<template><p>hi</p></template>',
      '<script>',
      "import { signal } from '@matthesketh/utopia-core';",
      'const a = 1;',
      '</script>',
    ].join('\n');
    const root = splitBlocks(original);
    // drop the first two lines of the script block, as the old depth miscount did.
    const truncated = {
      ...root,
      blocks: root.blocks.map((b) =>
        b.name === 'script' ? { ...b, start: b.start + 60, content: 'const a = 1;\n' } : b,
      ),
    };
    const printer = plugin.printers!['utopia-ast'];
    expect(() =>
      printer.print(
        { node: truncated } as never,
        { originalText: original } as never,
        (() => '') as never,
      ),
    ).toThrow(/Unexpected content before <script>/);
  });

  it('the synchronous print fallback collapses empty blocks', () => {
    const root = splitBlocks('<style></style>');
    const printer = plugin.printers!['utopia-ast'];
    const printed = printer.print(
      { node: root.blocks[0] } as never,
      {} as never,
      (() => '') as never,
    );
    expect(printed).toEqual(['<style>', '</style>']);
  });
});
