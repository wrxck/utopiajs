/**
 * Tests for the opt-in `fragments` compile option: multi-root templates,
 * multi-child slot content and empty templates emit real DOM fragments
 * instead of wrapper `<div>`s. With the flag off, output keeps the
 * historical wrapper shape byte-for-byte.
 */

import { describe, expect, it } from 'vitest';

import { compile } from '@/index';
import { compileTemplate } from '@/template-compiler';

const MULTI_ROOT = `<template>
  <header>Top</header>
  <main>Body</main>
</template>`;

const EMPTY = `<template>
</template>`;

const SLOT_MULTI = `<template>
  <Card>
    <span>one</span>
    <span>two</span>
  </Card>
</template>
<script>
import Card from './Card.utopia';
</script>`;

describe('fragments option — off (default)', () => {
  it('wraps multi-root templates in a div, as before', () => {
    const result = compile(MULTI_ROOT, { filename: 'Multi.utopia' });
    expect(result.code).toContain("createElement('div')");
    expect(result.code).not.toContain('createFragment');
  });

  it('emits a div for an empty template, as before', () => {
    const result = compile(EMPTY, { filename: 'Empty.utopia' });
    expect(result.code).toContain("const _root = createElement('div')");
    expect(result.code).not.toContain('createFragment');
  });

  it('wraps multi-child slot content in a div, as before', () => {
    const result = compile(SLOT_MULTI, { filename: 'Slots.utopia' });
    expect(result.code).toContain("createElement('div')");
    expect(result.code).not.toContain('createFragment');
  });
});

describe('fragments option — on', () => {
  it('emits a fragment for a multi-root template, with no wrapper div', () => {
    const result = compile(MULTI_ROOT, { filename: 'Multi.utopia', fragments: true });
    expect(result.code).toContain('createFragment([])');
    expect(result.code).not.toContain("createElement('div')");
    expect(result.code).toContain("createElement('header')");
    expect(result.code).toContain("createElement('main')");
  });

  it('emits an empty fragment for an empty template', () => {
    const result = compile(EMPTY, { filename: 'Empty.utopia', fragments: true });
    expect(result.code).toContain('const _root = createFragment([])');
    expect(result.code).not.toContain("createElement('div')");
  });

  it('emits a fragment for multi-child slot content', () => {
    const result = compile(SLOT_MULTI, { filename: 'Slots.utopia', fragments: true });
    expect(result.code).toContain('createFragment([');
    expect(result.code).not.toContain("createElement('div')");
  });

  it('imports createFragment from the runtime', () => {
    const result = compile(MULTI_ROOT, { filename: 'Multi.utopia', fragments: true });
    expect(result.code).toMatch(
      /import \{[^}]*createFragment[^}]*\} from '@matthesketh\/utopia-runtime'/,
    );
  });

  it('keeps single-root templates identical with the flag on', () => {
    const single = `<template>\n  <div>solo</div>\n</template>`;
    const off = compile(single, { filename: 'Solo.utopia' });
    const on = compile(single, { filename: 'Solo.utopia', fragments: true });
    expect(on.code).toBe(off.code);
  });

  it('keeps root-level u-if/u-else chains working under fragments', () => {
    const source = `<template>
  <p u-if="cond()">yes</p>
  <p u-else>no</p>
  <footer>after</footer>
</template>
<script>
import { signal } from '@matthesketh/utopia-core';
const cond = signal(true);
</script>`;
    const result = compile(source, { filename: 'Chain.utopia', fragments: true });
    // one createIf with BOTH branches — the chain must not decompose into
    // two independent createIf calls.
    const createIfCalls = result.code.match(/createIf\(/g) ?? [];
    expect(createIfCalls).toHaveLength(1);
    expect(result.code).toContain('createFragment([])');
  });

  it('does not put the scope attribute on the fragment (roots carry it)', () => {
    const scoped = `<template>
  <header>Top</header>
  <main>Body</main>
</template>
<style scoped>
header { color: red; }
</style>`;
    const result = compileTemplate(`\n  <header>Top</header>\n  <main>Body</main>\n`, {
      scopeId: 'data-u-test1234',
      fragments: true,
    });
    // each root element is scoped individually
    const scopedSets = result.code.match(/setAttr\(\w+, 'data-u-test1234', ''\)/g) ?? [];
    expect(scopedSets.length).toBe(2);
    // sanity: the SFC pipeline compiles too
    expect(compile(scoped, { filename: 'Scoped.utopia', fragments: true }).code).toContain(
      'createFragment',
    );
  });
});
