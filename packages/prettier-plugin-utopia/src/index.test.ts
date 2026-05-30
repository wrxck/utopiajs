import prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import plugin from './index';
import { splitBlocks } from './split-blocks';

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
});
