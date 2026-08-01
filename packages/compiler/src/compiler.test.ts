// ---------------------------------------------------------------------------
// compiler.test.ts — Tests for the @matthesketh/utopia-compiler package
// ---------------------------------------------------------------------------

import { signal, tick } from '@matthesketh/utopia-core';
import * as runtime from '@matthesketh/utopia-runtime';
import { describe, expect, it } from 'vitest';

import { compile } from '@/index';
import { parse } from '@/parser';
import { compileStyle, generateScopeId, preprocessStyle } from '@/style-compiler';
import type { ElementNode, TemplateNode, TextNode } from '@/template-compiler';
import { compileTemplate, parseTemplate } from '@/template-compiler';

/**
 * Execute a compiled render module against the real runtime helpers and
 * return the root node it produces. Free identifiers referenced by template
 * expressions are supplied via `scope`; `ctx` becomes the `_ctx` argument.
 */
function executeRender(
  code: string,
  scope: Record<string, unknown> = {},
  ctx: Record<string, unknown> = {},
): Node {
  const importMatch = code.match(/^import \{ ([^}]+) \} from '@matthesketh\/utopia-runtime'\n\n/);
  const helperNames = importMatch ? importMatch[1].split(', ') : [];
  const body = importMatch ? code.slice(importMatch[0].length) : code;
  const scopeNames = Object.keys(scope);
  const factory = new Function(...helperNames, ...scopeNames, `${body}\nreturn __render;`);
  const render = factory(
    ...helperNames.map((n) => (runtime as unknown as Record<string, unknown>)[n]),
    ...scopeNames.map((n) => scope[n]),
  );
  return render(ctx);
}

/**
 * Render `code` and attach the result to a host inside the document, the way
 * mount() does. A structural directive at the root of a template compiles to a
 * bare comment anchor whose branches are inserted as SIBLINGS of that anchor,
 * so the content only appears once the anchor has a parent — assertions must
 * read the host, not the returned node.
 */
function executeRenderInto(
  code: string,
  scope: Record<string, unknown> = {},
  ctx: Record<string, unknown> = {},
): HTMLElement {
  const host = document.createElement('main');
  document.body.appendChild(host);
  host.appendChild(executeRender(code, scope, ctx));
  return host;
}

// ===========================================================================
// 1. SFC Parser
// ===========================================================================

describe('SFC Parser', () => {
  it('extracts all three blocks from a complete SFC', () => {
    const source = `
<template>
  <div>Hello</div>
</template>

<script>
const x = 1
</script>

<style scoped>
.foo { color: red; }
</style>
`;
    const result = parse(source, 'test.utopia');

    expect(result.filename).toBe('test.utopia');
    expect(result.template).not.toBeNull();
    expect(result.script).not.toBeNull();
    expect(result.style).not.toBeNull();

    expect(result.template!.content).toContain('<div>Hello</div>');
    expect(result.script!.content).toContain('const x = 1');
    expect(result.style!.content).toContain('.foo { color: red; }');
  });

  it('parses the scoped attribute on the style block', () => {
    const source = `<template><div></div></template><style scoped>.x{}</style>`;
    const result = parse(source);
    expect(result.style!.attrs).toHaveProperty('scoped', true);
  });

  it('parses style block without scoped', () => {
    const source = `<template><div></div></template><style>.x{}</style>`;
    const result = parse(source);
    expect(result.style!.attrs).not.toHaveProperty('scoped');
  });

  it('parses attributes with values on blocks', () => {
    const source = `<script lang="ts">const x = 1</script>`;
    const result = parse(source);
    expect(result.script!.attrs).toEqual({ lang: 'ts' });
  });

  it('handles missing blocks gracefully', () => {
    const source = `<template><div></div></template>`;
    const result = parse(source);
    expect(result.template).not.toBeNull();
    expect(result.script).toBeNull();
    expect(result.style).toBeNull();
  });

  it('preserves content offsets', () => {
    const source = `<template><p>Hi</p></template>`;
    const result = parse(source);
    expect(result.template!.start).toBe(0);
    expect(result.template!.end).toBe(source.length);
  });

  it('throws on duplicate blocks', () => {
    const source = `
<template><div></div></template>
<template><span></span></template>
`;
    expect(() => parse(source)).toThrow(/[Dd]uplicate/);
  });

  it('throws on unclosed blocks', () => {
    const source = `<template><div></div>`;
    expect(() => parse(source)).toThrow(/[Uu]nclosed/);
  });

  it('handles multiline template content', () => {
    const source = `
<template>
  <div class="app">
    <h1>Title</h1>
    <p>Paragraph</p>
  </div>
</template>
`;
    const result = parse(source);
    expect(result.template!.content).toContain('<div class="app">');
    expect(result.template!.content).toContain('<h1>Title</h1>');
    expect(result.template!.content).toContain('<p>Paragraph</p>');
  });

  it('handles empty blocks', () => {
    const source = `<template></template><script></script><style></style>`;
    const result = parse(source);
    expect(result.template!.content).toBe('');
    expect(result.script!.content).toBe('');
    expect(result.style!.content).toBe('');
  });

  it('parses a <test> block and returns its content', () => {
    const source = `
<template><div>Hello</div></template>

<test>
import { describe, it } from 'vitest'
describe('test', () => { it('works', () => {}) })
</test>
`;
    const result = parse(source, 'test.utopia');
    expect(result.test).not.toBeNull();
    expect(result.test!.content).toContain("describe('test'");
  });

  it('returns test as null when no <test> block is present', () => {
    const source = `<template><div>Hello</div></template>`;
    const result = parse(source);
    expect(result.test).toBeNull();
  });

  it('throws on duplicate <test> blocks', () => {
    const source = `
<template><div></div></template>
<test>first</test>
<test>second</test>
`;
    expect(() => parse(source)).toThrow(/[Dd]uplicate/);
  });
});

// ===========================================================================
// 2. Template Parser (AST)
// ===========================================================================

describe('Template Parser', () => {
  it('parses a simple element', () => {
    const ast = parseTemplate('<div></div>');
    expect(ast).toHaveLength(1);
    expect(ast[0]).toMatchObject({ type: 1, tag: 'div', children: [] });
  });

  it('parses nested elements', () => {
    const ast = parseTemplate('<div><span>text</span></div>');
    expect(ast).toHaveLength(1);
    const div = ast[0] as ElementNode;
    expect(div.tag).toBe('div');
    expect(div.children).toHaveLength(1);
    const span = div.children[0] as ElementNode;
    expect(span.tag).toBe('span');
    expect(span.children).toHaveLength(1);
    expect(span.children[0]).toMatchObject({ type: 2, content: 'text' });
  });

  it('parses static attributes', () => {
    const ast = parseTemplate('<div class="foo" id="bar"></div>');
    const el = ast[0] as ElementNode;
    expect(el.attrs).toEqual([
      { name: 'class', value: 'foo' },
      { name: 'id', value: 'bar' },
    ]);
  });

  it('parses boolean attributes', () => {
    const ast = parseTemplate('<input disabled />');
    const el = ast[0] as ElementNode;
    expect(el.attrs).toEqual([{ name: 'disabled', value: null }]);
    expect(el.selfClosing).toBe(true);
  });

  it('parses single-quoted attribute values', () => {
    const ast = parseTemplate("<div class='foo'></div>");
    const el = ast[0] as ElementNode;
    expect(el.attrs[0]).toEqual({ name: 'class', value: 'foo' });
  });

  it('parses void elements without explicit self-close', () => {
    const ast = parseTemplate('<br>');
    expect(ast).toHaveLength(1);
    const el = ast[0] as ElementNode;
    expect(el.tag).toBe('br');
    expect(el.selfClosing).toBe(true);
  });

  it('parses self-closing tags', () => {
    const ast = parseTemplate('<img src="x.png" />');
    expect(ast).toHaveLength(1);
    const el = ast[0] as ElementNode;
    expect(el.tag).toBe('img');
    expect(el.selfClosing).toBe(true);
    expect(el.attrs).toEqual([{ name: 'src', value: 'x.png' }]);
  });

  it('parses text interpolation', () => {
    const ast = parseTemplate('<p>Hello {{ name() }}</p>');
    const p = ast[0] as ElementNode;
    expect(p.children).toHaveLength(2);
    expect(p.children[0]).toMatchObject({ type: 2, content: 'Hello ' });
    expect(p.children[1]).toMatchObject({ type: 3, expression: 'name()' });
  });

  it('parses multiple interpolations in text', () => {
    const ast = parseTemplate('<p>{{ a() }} and {{ b() }}</p>');
    const p = ast[0] as ElementNode;
    expect(p.children).toHaveLength(3);
    expect(p.children[0]).toMatchObject({ type: 3, expression: 'a()' });
    expect(p.children[1]).toMatchObject({ type: 2, content: ' and ' });
    expect(p.children[2]).toMatchObject({ type: 3, expression: 'b()' });
  });

  it('parses @click event shorthand', () => {
    const ast = parseTemplate('<button @click="handler">Go</button>');
    const btn = ast[0] as ElementNode;
    expect(btn.directives).toHaveLength(1);
    expect(btn.directives[0]).toMatchObject({
      kind: 'on',
      arg: 'click',
      expression: 'handler',
    });
  });

  it('parses u-on:event directive', () => {
    const ast = parseTemplate('<button u-on:click="handler">Go</button>');
    const btn = ast[0] as ElementNode;
    expect(btn.directives).toHaveLength(1);
    expect(btn.directives[0]).toMatchObject({
      kind: 'on',
      arg: 'click',
      expression: 'handler',
    });
  });

  it('parses :attr bind shorthand', () => {
    const ast = parseTemplate('<input :value="name()" />');
    const el = ast[0] as ElementNode;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0]).toMatchObject({
      kind: 'bind',
      arg: 'value',
      expression: 'name()',
    });
  });

  it('parses u-bind:attr directive', () => {
    const ast = parseTemplate('<input u-bind:value="name()" />');
    const el = ast[0] as ElementNode;
    expect(el.directives[0]).toMatchObject({
      kind: 'bind',
      arg: 'value',
      expression: 'name()',
    });
  });

  it('parses u-if directive', () => {
    const ast = parseTemplate('<div u-if="show()">conditional</div>');
    const el = ast[0] as ElementNode;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0]).toMatchObject({
      kind: 'if',
      expression: 'show()',
    });
  });

  it('parses u-for directive', () => {
    const ast = parseTemplate('<li u-for="item in items()">{{ item }}</li>');
    const el = ast[0] as ElementNode;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0]).toMatchObject({
      kind: 'for',
      expression: 'item in items()',
    });
  });

  it('parses u-model directive', () => {
    const ast = parseTemplate('<input u-model="name" />');
    const el = ast[0] as ElementNode;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0]).toMatchObject({
      kind: 'model',
      expression: 'name',
    });
  });

  it('parses HTML comments', () => {
    const ast = parseTemplate('<!-- comment --><div></div>');
    expect(ast).toHaveLength(2);
    expect(ast[0]).toMatchObject({ type: 4, content: 'comment' });
    expect(ast[1]).toMatchObject({ type: 1, tag: 'div' });
  });

  it('parses PascalCase component tags', () => {
    const ast = parseTemplate('<MyComponent foo="bar" />');
    const el = ast[0] as ElementNode;
    expect(el.tag).toBe('MyComponent');
    expect(el.attrs).toEqual([{ name: 'foo', value: 'bar' }]);
  });

  it('parses deeply nested structures', () => {
    const ast = parseTemplate('<div><ul><li><a href="#">link</a></li></ul></div>');
    const div = ast[0] as ElementNode;
    const ul = div.children.find((c: TemplateNode) => c.type === 1) as ElementNode;
    const li = ul.children.find((c: TemplateNode) => c.type === 1) as ElementNode;
    const a = li.children.find((c: TemplateNode) => c.type === 1) as ElementNode;
    expect(a.tag).toBe('a');
    expect(a.attrs[0]).toEqual({ name: 'href', value: '#' });
    expect((a.children.find((c: TemplateNode) => c.type === 2) as TextNode).content).toBe('link');
  });

  it('parses event modifier syntax', () => {
    const ast = parseTemplate('<button @click.prevent="handler">Go</button>');
    const btn = ast[0] as ElementNode;
    expect(btn.directives[0]).toMatchObject({
      kind: 'on',
      arg: 'click',
      modifiers: ['prevent'],
    });
  });

  it('throws on unterminated interpolation', () => {
    expect(() => parseTemplate('<p>{{ oops</p>')).toThrow(/[Uu]nterminated/);
  });

  it('throws on missing closing tag', () => {
    expect(() => parseTemplate('<div><span></div>')).toThrow();
  });
});

// ===========================================================================
// 3. Template Compilation (codegen)
// ===========================================================================

describe('Template Compilation', () => {
  it('compiles a simple static element', () => {
    const result = compileTemplate('<div class="app">Hello</div>');
    expect(result.code).toContain("createElement('div')");
    expect(result.code).toContain('setAttr(');
    expect(result.code).toContain("'class', 'app'");
    expect(result.code).toContain('createTextNode(');
    expect(result.code).toContain('function __render(_ctx)');
    expect(result.helpers.has('createElement')).toBe(true);
    expect(result.helpers.has('setAttr')).toBe(true);
  });

  it('compiles text interpolation with reactive effect', () => {
    const result = compileTemplate('<h1>{{ count() }}</h1>');
    expect(result.code).toContain("createTextNode('')");
    expect(result.code).toContain('createEffect(');
    expect(result.code).toContain('setText(');
    expect(result.code).toContain('count()');
    expect(result.code).not.toContain('_ctx.');
    expect(result.helpers.has('createEffect')).toBe(true);
    expect(result.helpers.has('setText')).toBe(true);
  });

  it('compiles @click event binding', () => {
    const result = compileTemplate('<button @click="increment">+1</button>');
    expect(result.code).toContain('addEventListener(');
    expect(result.code).toContain("'click'");
    expect(result.code).toContain('increment');
    expect(result.code).not.toContain('_ctx.');
    expect(result.helpers.has('addEventListener')).toBe(true);
  });

  it('compiles u-on:event directive', () => {
    const result = compileTemplate('<button u-on:click="handler">Go</button>');
    expect(result.code).toContain('addEventListener(');
    expect(result.code).toContain("'click'");
    expect(result.code).toContain(', handler)');
    expect(result.code).not.toContain('_ctx.');
  });

  it('compiles u-bind:attr with reactive effect', () => {
    const result = compileTemplate('<input u-bind:value="name()" />');
    expect(result.code).toContain('createEffect(');
    expect(result.code).toContain('setAttr(');
    expect(result.code).toContain("'value'");
    expect(result.code).toContain('name()');
    expect(result.code).not.toContain('_ctx.');
  });

  it('compiles :attr shorthand', () => {
    const result = compileTemplate('<img :src="imageUrl()" />');
    expect(result.code).toContain("'src'");
    expect(result.code).toContain('imageUrl()');
    expect(result.code).not.toContain('_ctx.');
  });

  it('compiles u-if with conditional rendering', () => {
    const result = compileTemplate('<div u-if="show()">Conditional</div>');
    expect(result.code).toContain("createComment('u-if')");
    expect(result.code).toContain('createIf(');
    expect(result.code).toContain('Boolean(');
    expect(result.code).toContain('show()');
    expect(result.code).not.toContain('_ctx.');
    // The element creation should be inside a function.
    expect(result.code).toContain("createElement('div')");
    expect(result.helpers.has('createIf')).toBe(true);
    expect(result.helpers.has('createComment')).toBe(true);
  });

  it('compiles u-for with list rendering', () => {
    const result = compileTemplate('<li u-for="item in items()">{{ item }}</li>');
    expect(result.code).toContain("createComment('u-for')");
    expect(result.code).toContain('createFor(');
    expect(result.code).toContain('items()');
    expect(result.code).not.toContain('_ctx.');
    // The item should be a function parameter (followed by the row scope).
    expect(result.code).toMatch(/\(item, _index, _scope\d+\) =>/);
    // Inside the for body, `item` should be used directly — behind the row's
    // track call, which is what re-runs the binding when the row is reused.
    expect(result.code).toMatch(/String\(\(_track\d+\(\), item\)\)/);
    expect(result.helpers.has('createFor')).toBe(true);
    expect(result.helpers.has('createComment')).toBe(true);
  });

  it('compiles u-model with two-way binding', () => {
    const result = compileTemplate('<input u-model="name" />');
    // both directions are handled by the runtime applyModel helper, which picks
    // the right property + event for the control kind at runtime.
    expect(result.code).toContain('applyModel(');
    expect(result.code).toContain('applyModel(_el0, name)');
    expect(result.helpers.has('applyModel')).toBe(true);
    expect(result.code).not.toContain('_ctx.');
  });

  it('passes u-model modifiers (number/trim/lazy) to applyModel', () => {
    const result = compileTemplate('<input type="number" u-model.number.lazy="age" />');
    expect(result.code).toContain('applyModel(_el0, age, { number: true, lazy: true })');
  });

  it('compiles u-show to an in-place setShow visibility toggle', () => {
    const result = compileTemplate('<div u-show="open">hi</div>');
    expect(result.code).toContain('setShow(_el0, () => open)');
    expect(result.helpers.has('setShow')).toBe(true);
    // u-show keeps the element mounted — no structural createIf/anchor.
    expect(result.code).not.toContain('createIf');
    expect(result.code).not.toContain('_ctx.');
  });

  it('compiles nested elements', () => {
    const result = compileTemplate('<div><span><a href="#">link</a></span></div>');
    expect(result.code).toContain("createElement('div')");
    expect(result.code).toContain("createElement('span')");
    expect(result.code).toContain("createElement('a')");
    expect(result.code).toContain("'href', '#'");
    expect(result.code).toContain('appendChild(');
    expect(result.helpers.has('appendChild')).toBe(true);
  });

  it('compiles PascalCase component references', () => {
    const result = compileTemplate('<MyComponent title="hello" />');
    expect(result.code).toContain('createComponent(MyComponent,');
    expect(result.code).toContain("'title': 'hello'");
    expect(result.code).not.toContain('_ctx.');
  });

  it('maps a component @event to an on<Event> callback prop', () => {
    const ref = compileTemplate('<MyComponent @select="handleSelect" />');
    // bare reference passed straight through.
    expect(ref.code).toContain("'onSelect': handleSelect");

    const inline = compileTemplate('<MyComponent @select-item="picked = $event" />');
    // hyphenated event camelCased; inline expression wrapped with $event param.
    expect(inline.code).toContain("'onSelectItem': ($event) => { picked = $event }");
  });

  it('applies scope ID to all elements when provided', () => {
    const result = compileTemplate('<div><span>hi</span></div>', {
      scopeId: 'data-u-abc123',
    });
    // Both the div and the span should get the scope ID.
    const setAttrCalls = result.code.match(/setAttr\([^,]+, 'data-u-abc123', ''\)/g);
    expect(setAttrCalls).not.toBeNull();
    expect(setAttrCalls!.length).toBeGreaterThanOrEqual(2);
  });

  it('imports only the helpers that are used', () => {
    const result = compileTemplate('<div>static text</div>');
    expect(result.code).toContain('createElement');
    expect(result.code).toContain('createTextNode');
    // Should NOT contain helpers not used.
    expect(result.code).not.toContain('createEffect');
    expect(result.code).not.toContain('createIf');
    expect(result.code).not.toContain('createFor');
    expect(result.code).not.toContain('addEventListener');
  });

  it('generates valid import statement from @matthesketh/utopia-runtime', () => {
    const result = compileTemplate('<div>{{ x() }}</div>');
    expect(result.code).toContain("from '@matthesketh/utopia-runtime'");
  });

  it('emits appendChild before createFor for nested u-for', () => {
    const result = compileTemplate('<ul><li u-for="item in items()">{{ item }}</li></ul>');
    const lines = result.code.split('\n');
    // Find the appendChild that appends the u-for anchor comment to its parent
    const anchorVar = result.code.match(/const (\w+) = createComment\('u-for'\)/)?.[1];
    expect(anchorVar).toBeTruthy();
    const appendIdx = lines.findIndex((l) => l.includes('appendChild(') && l.includes(anchorVar!));
    const createForIdx = lines.findIndex((l) => l.includes('createFor('));
    // appendChild of the anchor must come before createFor
    expect(appendIdx).toBeGreaterThan(-1);
    expect(createForIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeLessThan(createForIdx);
  });

  it('emits appendChild before createIf for nested u-if', () => {
    const result = compileTemplate('<div><span u-if="show()">hi</span></div>');
    const lines = result.code.split('\n');
    const anchorVar = result.code.match(/const (\w+) = createComment\('u-if'\)/)?.[1];
    expect(anchorVar).toBeTruthy();
    const appendIdx = lines.findIndex((l) => l.includes('appendChild(') && l.includes(anchorVar!));
    const createIfIdx = lines.findIndex((l) => l.includes('createIf('));
    expect(appendIdx).toBeGreaterThan(-1);
    expect(createIfIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeLessThan(createIfIdx);
  });

  it('handles a complex template with all features', () => {
    const template = `
      <div class="counter">
        <h1>{{ count() }}</h1>
        <p>Doubled: {{ doubled() }}</p>
        <button @click="increment">Click me</button>
        <input u-bind:value="name()" @input="updateName" />
        <div u-if="show()">Conditional content</div>
        <ul>
          <li u-for="item in items()">{{ item }}</li>
        </ul>
      </div>
    `;
    const result = compileTemplate(template);
    // Should compile without error.
    expect(result.code).toContain('function __render(_ctx)');
    expect(result.code).not.toContain('_ctx.');
    // Check all helpers are imported.
    expect(result.helpers.has('createElement')).toBe(true);
    expect(result.helpers.has('createTextNode')).toBe(true);
    expect(result.helpers.has('createEffect')).toBe(true);
    expect(result.helpers.has('setText')).toBe(true);
    expect(result.helpers.has('setAttr')).toBe(true);
    expect(result.helpers.has('addEventListener')).toBe(true);
    expect(result.helpers.has('createIf')).toBe(true);
    expect(result.helpers.has('createFor')).toBe(true);
  });
});

// ===========================================================================
// 4. Style Compiler
// ===========================================================================

describe('Style Compiler', () => {
  it('returns CSS unchanged when not scoped', () => {
    const result = compileStyle({
      source: '.foo { color: red; }',
      filename: 'test.utopia',
      scoped: false,
    });
    expect(result.css).toBe('.foo { color: red; }');
    expect(result.scopeId).toBeNull();
  });

  it('scopes class selectors', () => {
    const result = compileStyle({
      source: '.foo { color: red; }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('.foo[data-u-test]');
    expect(result.css).toContain('color: red;');
    expect(result.scopeId).toBe('data-u-test');
  });

  it('scopes element selectors', () => {
    const result = compileStyle({
      source: 'h1 { color: blue; }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('h1[data-u-test]');
  });

  it('scopes grouped selectors', () => {
    const result = compileStyle({
      source: 'h1, .title { font-weight: bold; }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('h1[data-u-test]');
    expect(result.css).toContain('.title[data-u-test]');
  });

  it('scopes descendant selectors on the last part', () => {
    const result = compileStyle({
      source: '.parent .child { margin: 0; }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('.parent .child[data-u-test]');
  });

  it('preserves pseudo-classes and inserts scope before them', () => {
    const result = compileStyle({
      source: 'a:hover { text-decoration: underline; }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('a[data-u-test]:hover');
  });

  it('preserves pseudo-elements and inserts scope before them', () => {
    const result = compileStyle({
      source: 'p::before { content: ""; }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('p[data-u-test]::before');
  });

  it('scopes selectors inside @media blocks', () => {
    const result = compileStyle({
      source: '@media (max-width: 600px) { .foo { display: none; } }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('@media (max-width: 600px)');
    expect(result.css).toContain('.foo[data-u-test]');
  });

  it('does NOT scope inside @keyframes', () => {
    const result = compileStyle({
      source:
        '@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    // "from" and "to" should NOT have scope attributes appended.
    expect(result.css).not.toContain('from[data-u-test]');
    expect(result.css).not.toContain('to[data-u-test]');
  });

  it('generates deterministic scope IDs from filenames', () => {
    const id1 = generateScopeId('src/App.utopia');
    const id2 = generateScopeId('src/App.utopia');
    const id3 = generateScopeId('src/Other.utopia');
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toMatch(/^data-u-[0-9a-f]{8}$/);
  });

  it('handles multiple rules', () => {
    const result = compileStyle({
      source: `.a { color: red; }\n.b { color: blue; }`,
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('.a[data-u-test]');
    expect(result.css).toContain('.b[data-u-test]');
  });

  it('handles CSS comments', () => {
    const result = compileStyle({
      source: '/* comment */ .foo { color: red; }',
      filename: 'test.utopia',
      scoped: true,
      scopeId: 'data-u-test',
    });
    expect(result.css).toContain('/* comment */');
    expect(result.css).toContain('.foo[data-u-test]');
  });
});

// ===========================================================================
// 5. Full compile() integration
// ===========================================================================

describe('compile() integration', () => {
  const fullSFC = `
<template>
  <div class="counter">
    <h1>{{ count() }}</h1>
    <button @click="increment">+1</button>
  </div>
</template>

<script>
import { signal } from '@matthesketh/utopia-core'

const count = signal(0)

function increment() {
  count.update(n => n + 1)
}
</script>

<style scoped>
.counter { padding: 20px; }
h1 { color: blue; }
</style>
`;

  it('produces code and css from a complete SFC', () => {
    const result = compile(fullSFC, { filename: 'Counter.utopia' });

    // Code should contain the render function and ComponentDefinition export.
    expect(result.code).toContain('function __render(_ctx)');
    expect(result.code).toContain('export default { render: __render }');
    // Code should contain the user script.
    expect(result.code).toContain("import { signal } from '@matthesketh/utopia-core'");
    expect(result.code).toContain('const count = signal(0)');
    expect(result.code).toContain('function increment()');
    // Code should contain runtime imports.
    expect(result.code).toContain("from '@matthesketh/utopia-runtime'");

    // CSS should be scoped.
    expect(result.css).toContain('.counter[data-u-');
    expect(result.css).toContain('h1[data-u-');
    expect(result.css).toContain('padding: 20px;');
    expect(result.css).toContain('color: blue;');
  });

  it('applies scope ID to template elements when style is scoped', () => {
    const result = compile(fullSFC, { filename: 'Counter.utopia' });
    // The render function should set the scope data attribute on elements.
    expect(result.code).toContain('data-u-');
  });

  it('compiles an SFC without a style block', () => {
    const source = `
<template>
  <div>Hello</div>
</template>

<script>
const x = 1
</script>
`;
    const result = compile(source);
    expect(result.code).toContain('function __render(_ctx)');
    expect(result.code).toContain('export default { render: __render }');
    expect(result.code).toContain('const x = 1');
    expect(result.css).toBe('');
  });

  it('compiles an SFC without a script block', () => {
    const source = `
<template>
  <div>Static</div>
</template>
`;
    const result = compile(source);
    expect(result.code).toContain('function __render(_ctx)');
    expect(result.code).toContain('export default { render: __render }');
    expect(result.code).toContain("createElement('div')");
  });

  it('compiles an SFC with non-scoped styles', () => {
    const source = `
<template>
  <div>Hello</div>
</template>

<style>
.foo { color: red; }
</style>
`;
    const result = compile(source);
    // CSS should be returned as-is (not scoped).
    expect(result.css).toContain('.foo { color: red; }');
    // No data-u- attributes in the rendered code since style is not scoped.
    expect(result.code).not.toContain('data-u-');
  });

  it('produces code that uses direct module-level references', () => {
    const source = `
<template>
  <div>
    <p>{{ message() }}</p>
    <button @click="handleClick">Go</button>
  </div>
</template>

<script>
import { signal } from '@matthesketh/utopia-core'
const message = signal('hello')
function handleClick() {}
</script>
`;
    const result = compile(source);
    expect(result.code).toContain('message()');
    expect(result.code).toContain(', handleClick)');
    expect(result.code).not.toContain('_ctx.');
  });

  it('handles u-for with proper item scoping in full compile', () => {
    const source = `
<template>
  <ul>
    <li u-for="item in items()">{{ item }}</li>
  </ul>
</template>

<script>
import { signal } from '@matthesketh/utopia-core'
const items = signal(['a', 'b', 'c'])
</script>
`;
    const result = compile(source);
    // `items()` should be a direct reference (no _ctx).
    expect(result.code).toContain('items()');
    expect(result.code).not.toContain('_ctx.');
    // `item` inside the for body should be a function parameter.
    expect(result.code).toMatch(/\(item, _index, _scope\d+\) =>/);
    expect(result.code).toMatch(/String\(\(_track\d+\(\), item\)\)/);
  });

  it('compiles a SFC with all directive types', () => {
    const source = `
<template>
  <div>
    <p>{{ count() }}</p>
    <button @click="inc">+</button>
    <input :value="name()" />
    <input u-model="name" />
    <span u-if="show()">visible</span>
    <li u-for="x in list()">{{ x }}</li>
  </div>
</template>

<script>
import { signal, computed } from '@matthesketh/utopia-core'
const count = signal(0)
const name = signal('')
const show = signal(true)
const list = signal([1, 2, 3])
function inc() { count.update(n => n + 1) }
</script>
`;
    const result = compile(source);
    // All the key constructs should be present.
    expect(result.code).toContain('createEffect');
    expect(result.code).toContain('addEventListener');
    expect(result.code).toContain('createIf');
    expect(result.code).toContain('createFor');
    expect(result.code).toContain('setText');
    expect(result.code).toContain('setAttr');
  });

  it('allows overriding scopeId via options', () => {
    const source = `
<template>
  <div>test</div>
</template>

<style scoped>
.x { color: red; }
</style>
`;
    const result = compile(source, { scopeId: 'data-u-custom' });
    expect(result.css).toContain('.x[data-u-custom]');
    expect(result.code).toContain('data-u-custom');
  });

  it('ignores <test> block — test code is not in compiled output', () => {
    const source = `
<template>
  <div>Hello</div>
</template>

<script>
const x = 1
</script>

<test>
import { describe, it, expect } from 'vitest'
describe('my test', () => {
  it('should work', () => { expect(true).toBe(true) })
})
</test>
`;
    const result = compile(source);
    expect(result.code).toContain('function __render(_ctx)');
    expect(result.code).toContain('const x = 1');
    // Test block content must NOT appear in compiled output.
    expect(result.code).not.toContain('describe(');
    expect(result.code).not.toContain('my test');
    expect(result.code).not.toContain('should work');
    expect(result.css).toBe('');
  });
});

// ===========================================================================
// 6. Entity decoding edge cases
// ===========================================================================

describe('Entity decoding', () => {
  it('preserves out-of-range numeric entity &#20000000; without crashing', () => {
    // 20000000 exceeds the max Unicode code point (0x10FFFF = 1114111).
    // The compiler should not crash and the original entity text should be
    // preserved in the output.
    const result = compileTemplate('<p>&#20000000;</p>');
    expect(result.code).toContain('createTextNode');
    // The literal entity should survive (not decoded) since it is invalid.
    expect(result.code).toContain('&#20000000;');
  });

  it('decodes the max valid Unicode code point &#1114111; correctly', () => {
    // 1114111 === 0x10FFFF — the highest valid Unicode code point.
    const result = compileTemplate('<p>&#1114111;</p>');
    expect(result.code).toContain('createTextNode');
    // The entity should be decoded to its character representation.
    const expectedChar = String.fromCodePoint(0x10ffff);
    expect(result.code).toContain(expectedChar);
    // The raw entity should NOT appear in the output.
    expect(result.code).not.toContain('&#1114111;');
  });
});

// ===========================================================================
// 7. isComponentTag validation
// ===========================================================================

describe('isComponentTag validation', () => {
  it('compiles PascalCase tag with createComponent', () => {
    const result = compileTemplate('<MyComponent />');
    expect(result.code).toContain('createComponent(MyComponent,');
    expect(result.helpers.has('createComponent')).toBe(true);
  });

  it('does NOT treat lowercase hyphenated tag as a component', () => {
    // <my-component /> is lowercase, so it should be treated as a regular
    // HTML element (createElement), not a component (createComponent).
    const result = compileTemplate('<my-component />');
    expect(result.code).toContain("createElement('my-component')");
    expect(result.code).not.toContain('createComponent');
    expect(result.helpers.has('createElement')).toBe(true);
    expect(result.helpers.has('createComponent')).toBe(false);
  });

  it('does NOT treat a tag starting with a digit as a component', () => {
    // Tags starting with digits should not match isComponentTag.
    // The parser allows digits in tag names, but codegen should use createElement.
    const result = compileTemplate('<H1tag />');
    // H1tag starts with uppercase so it IS a component.
    expect(result.code).toContain('createComponent(H1tag,');
  });

  it('treats a tag with only uppercase start and alphanumeric as component', () => {
    const result = compileTemplate('<Widget2 />');
    expect(result.code).toContain('createComponent(Widget2,');
    expect(result.helpers.has('createComponent')).toBe(true);
  });
});

// ===========================================================================
// u-else-if directive
// ===========================================================================

describe('u-else-if directive', () => {
  it('parses u-else-if as a directive with kind else-if and an expression', () => {
    const ast = parseTemplate('<div u-else-if="x > 1">content</div>');
    expect(ast).toHaveLength(1);
    const el = ast[0] as any;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0].kind).toBe('else-if');
    expect(el.directives[0].expression).toBe('x > 1');
  });

  it('generates nested createIf for u-if + u-else-if', () => {
    const result = compileTemplate('<div u-if="a">A</div><div u-else-if="b">B</div>');
    // The outer createIf should exist
    expect(result.code).toContain('createIf(');
    // Should contain two createIf calls (one nested inside the false branch)
    const createIfCount = (result.code.match(/createIf\(/g) || []).length;
    expect(createIfCount).toBe(2);
    // Both conditions should appear
    expect(result.code).toContain('Boolean(a)');
    expect(result.code).toContain('Boolean(b)');
  });

  it('generates correct chain for u-if + u-else-if + u-else', () => {
    const result = compileTemplate(
      '<div u-if="a">A</div><div u-else-if="b">B</div><div u-else>C</div>',
    );
    const createIfCount = (result.code.match(/createIf\(/g) || []).length;
    expect(createIfCount).toBe(2);
    expect(result.code).toContain('Boolean(a)');
    expect(result.code).toContain('Boolean(b)');
    // The else branch should create a div with text C
    expect(result.code).toContain('"C"');
  });

  it('chains multiple u-else-if branches correctly', () => {
    const result = compileTemplate(
      '<div u-if="a">A</div><div u-else-if="b">B</div><div u-else-if="c">C</div><div u-else>D</div>',
    );
    const createIfCount = (result.code.match(/createIf\(/g) || []).length;
    expect(createIfCount).toBe(3);
    expect(result.code).toContain('Boolean(a)');
    expect(result.code).toContain('Boolean(b)');
    expect(result.code).toContain('Boolean(c)');
  });

  it('silently skips orphaned u-else-if without preceding u-if', () => {
    // Should not throw — just ignore the orphan
    const result = compileTemplate('<div u-else-if="x">orphan</div>');
    expect(result.code).not.toContain('createIf');
  });
});

// ===========================================================================
// Template Security
// ===========================================================================

describe('Template security — interpolation escaping', () => {
  it('interpolations use setText (textContent) and never innerHTML', () => {
    const result = compileTemplate('<p>{{ message() }}</p>');
    // Must use setText which sets textContent, inherently safe against XSS
    expect(result.code).toContain('setText');
    expect(result.code).toContain('createTextNode');
    // Must never use innerHTML or insertAdjacentHTML
    expect(result.code).not.toContain('innerHTML');
    expect(result.code).not.toContain('insertAdjacentHTML');
    expect(result.code).not.toContain('outerHTML');
  });

  it('static text uses createTextNode (safe textContent)', () => {
    const result = compileTemplate('<p>Hello <strong>world</strong></p>');
    expect(result.code).toContain('createTextNode');
    expect(result.code).not.toContain('innerHTML');
  });

  it('u-bind uses setAttr (not direct property assignment)', () => {
    const result = compileTemplate('<a u-bind:href="url()">link</a>');
    expect(result.code).toContain('setAttr');
    expect(result.code).not.toContain('innerHTML');
  });
});

// ===========================================================================
// u-transition directive
// ===========================================================================

describe('u-transition directive', () => {
  it('compiles u-transition with expression name', () => {
    const result = compileTemplate('<div u-transition="fade">content</div>');
    expect(result.code).toContain('createTransition');
    expect(result.code).toContain("name: 'fade'");
    expect(result.helpers.has('createTransition')).toBe(true);
  });

  it('compiles u-transition with arg name', () => {
    const result = compileTemplate('<div u-transition:slide>content</div>');
    expect(result.code).toContain('createTransition');
    expect(result.code).toContain("name: 'slide'");
  });

  it('compiles u-transition with duration modifier', () => {
    const result = compileTemplate('<div u-transition:fade.duration-300>content</div>');
    expect(result.code).toContain("name: 'fade'");
    expect(result.code).toContain('duration: 300');
  });

  it('defaults transition name to fade when no name given', () => {
    const result = compileTemplate('<div u-transition>content</div>');
    expect(result.code).toContain('createTransition');
    expect(result.code).toContain("name: 'fade'");
  });
});

describe('u-html directive — sanitization', () => {
  it('u-html uses setSafeHtml by default', () => {
    const result = compileTemplate('<div u-html="content()"></div>');
    expect(result.code).toContain('setSafeHtml');
    expect(result.helpers.has('setSafeHtml')).toBe(true);
  });

  it('u-html.raw uses setHtml for trusted content', () => {
    const result = compileTemplate('<div u-html.raw="trustedHtml()"></div>');
    expect(result.code).toContain('setHtml');
    expect(result.code).not.toContain('setSafeHtml');
    expect(result.helpers.has('setHtml')).toBe(true);
  });
});

describe('static class + :class merge', () => {
  it('merges the static class into the binding effect', () => {
    const out = compileTemplate(`<button class="chip" :class="on() ? 'on' : ''">x</button>`);
    expect(out.code).toContain("mergeClass('chip'");
    // the static class must not also be set on its own (the binding would
    // immediately clobber it).
    expect(out.code).not.toContain("setAttr(_el0, 'class', 'chip')");
  });

  it('a lone :class binding stays untouched', () => {
    const out = compileTemplate(`<button :class="cls()">x</button>`);
    expect(out.code).not.toContain('mergeClass');
  });

  it('a lone static class stays untouched', () => {
    const out = compileTemplate(`<button class="chip">x</button>`);
    expect(out.code).toContain("setAttr(_el0, 'class', 'chip')");
    expect(out.code).not.toContain('mergeClass');
  });
});

// ===========================================================================
// defineProps — opt-in per-instance components
// ===========================================================================

describe('defineProps / per-instance components', () => {
  it('keeps the module-scope shape when defineProps is absent', () => {
    const src = `
<template><div>{{ count() }}</div></template>
<script>
import { signal } from '@matthesketh/utopia-runtime'
const count = signal(0)
</script>
`;
    const { code } = compile(src, { filename: 'Plain.utopia' });
    expect(code).toContain('export default { render: __render }');
    expect(code).not.toContain('function __setup');
    // the script stays at module scope.
    expect(code).toMatch(/const count = signal\(0\)/);
  });

  it('wraps the script in setup(__props) when defineProps is used', () => {
    const src = `
<template><strong>{{ label() }}</strong></template>
<script>
import { signal } from '@matthesketh/utopia-runtime'
const { label } = defineProps()
const local = signal(1)
</script>
`;
    const { code } = compile(src, { filename: 'Greeting.utopia' });
    // per-instance wrapper + the runtime contract export.
    expect(code).toContain('function __setup(__uProps)');
    expect(code).toContain('setup: __setup');
    expect(code).toContain('render: (__ctx) => __ctx.__render(__ctx)');
    expect(code).toContain('return { __render }');
    // defineProps() resolves to the setup parameter.
    expect(code).toContain('const { label } = __uProps');
    expect(code).not.toMatch(/defineProps\s*\(/);
  });

  it('hoists user imports above the setup function', () => {
    const src = `
<template><span>{{ x() }}</span></template>
<script>
import { signal } from '@matthesketh/utopia-runtime'
import { helper } from '@/lib/helper'
const { x } = defineProps()
</script>
`;
    const { code } = compile(src, { filename: 'Hoist.utopia' });
    const importIdx = code.indexOf("import { helper } from '@/lib/helper'");
    const setupIdx = code.indexOf('function __setup');
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(setupIdx).toBeGreaterThan(importIdx);
    // the import must not remain inside the setup body.
    expect(code.slice(setupIdx)).not.toContain('import { helper }');
  });

  it('forwards component bindings as props (signal passed uncalled)', () => {
    // a parent passing a signal by reference is how reactive props flow.
    const { code } = compileTemplate(`<Panel :template="template" :date="day()" />`);
    expect(code).toContain("createComponent(Panel, { 'template': template, 'date': day() }");
  });

  it('detection is stateless across interleaved compiles (no /g lastIndex bug)', () => {
    const withProps = `<template><b>{{ a() }}</b></template>
<script>const { a } = defineProps()</script>`;
    const plain = `<template><i>x</i></template><script>const y = 1</script>`;
    // compile the props component, then a plain one, then the props one again —
    // a stateful detection regex would skip the second props compile.
    expect(compile(withProps, { filename: 'A.utopia' }).code).toContain('function __setup');
    expect(compile(plain, { filename: 'B.utopia' }).code).toContain(
      'export default { render: __render }',
    );
    const third = compile(withProps, { filename: 'C.utopia' }).code;
    expect(third).toContain('function __setup');
    expect(third).toContain('const { a } = __uProps');
  });

  it('hoists an import that has a trailing line comment', () => {
    const src = `<template><b>{{ n() }}</b></template>
<script>
import { signal } from '@matthesketh/utopia-runtime' // reactive
const { n } = defineProps()
</script>`;
    const { code } = compile(src, { filename: 'Trail.utopia' });
    const setupIdx = code.indexOf('function __setup');
    // the import is hoisted out of the setup body (no illegal in-function import).
    expect(code.slice(setupIdx)).not.toContain('import { signal }');
  });

  it('rejects a type parameter with a clear message (use a cast instead)', () => {
    const src = `<template><b>{{ a() }}</b></template>
<script>const { a } = defineProps<{ a: () => string }>()</script>`;
    expect(() => compile(src, { filename: 'Typed.utopia' })).toThrow(
      /defineProps<T>\(\) is not supported/,
    );
  });

  it('throws a clear error when defineProps is given arguments', () => {
    const src = `<template><b>x</b></template>
<script>const p = defineProps({ a: 1 })</script>`;
    expect(() => compile(src, { filename: 'Args.utopia' })).toThrow(/takes no arguments/);
  });

  it('does not opt in when defineProps only appears in a comment', () => {
    const src = `<template><b>x</b></template>
<script>
// to make this per-instance, call defineProps()
const z = 1
</script>`;
    const { code } = compile(src, { filename: 'Comment.utopia' });
    expect(code).toContain('export default { render: __render }');
    expect(code).not.toContain('function __setup');
  });
});

// ===========================================================================
// u-else-if chains — nested createIf must stay in scope
// ===========================================================================

describe('u-else-if codegen', () => {
  it('emits a u-if / u-else-if / u-else chain as valid, in-scope code', () => {
    const { code } = compileTemplate(
      `<div><p u-if="a">A</p><p u-else-if="b">B</p><p u-else>C</p></div>`,
    );
    const helpers = (code.match(/import \{ ([^}]*) \}/)?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = code.replace(/^import[^\n]*\n/, '');
    // a buggy else-if emitted its nested createIf at the render top level,
    // referencing a closure-local anchor → ReferenceError when __render runs.
    const fn = new Function(...helpers, `${body}\nreturn __render({});`);
    const stub = (): unknown => ({});
    expect(() => fn(...helpers.map(() => stub))).not.toThrow();
  });

  it('places the nested else-if createIf inside a branch closure', () => {
    const { code } = compileTemplate(`<p u-if="a">A</p><p u-else-if="b">B</p>`);
    // both conditions are wired...
    expect(code).toContain('Boolean(a)');
    expect(code).toContain('Boolean(b)');
    // ...and the else-if createIf is indented (inside the false-branch closure),
    // never at the bare render-body indent.
    expect(code).not.toMatch(/\n {2}createIf\([^\n]*Boolean\(b\)/);
  });
});

// ===========================================================================
// u-for row scope — the loop variable has to be reactive
// ===========================================================================
//
// A keyed row survives an immutable list update (that is the point of :key),
// so the row must be told that it now holds a different item. The loop
// variable stays a plain parameter — templates keep writing `item.name`, not
// `item().name` — and the codegen supplies the two halves that make it
// reactive: `onUpdate` rebinds the parameter, and a `track()` call in front of
// every reactive expression subscribes that expression's effect to the row.

describe('u-for row scope codegen', () => {
  it('takes the row scope and rebinds the loop variables from it', () => {
    const { code } = compileTemplate(
      '<li u-for="(item, i) in items()" :key="item.id">{{ item.n }}</li>',
    );
    const scopeVar = code.match(/\(item, i, (_scope\d+)\) =>/)?.[1];
    expect(scopeVar).toBeTruthy();
    // the track fn is read defensively, so a caller that passes no scope (a
    // hand-written renderItem, or an older runtime) still renders.
    expect(code).toMatch(
      new RegExp(`const _track\\d+ = ${scopeVar} \\? ${scopeVar}\\.track : \\(\\) => \\{\\}`),
    );
    expect(code).toContain(`if (${scopeVar}) ${scopeVar}.onUpdate(`);
    // the rebinder assigns the author's own names — nothing downstream is rewritten.
    expect(code).toMatch(
      /\.onUpdate\(\(_item\d+, _idx\d+\) => \{ item = _item\d+; i = _idx\d+ \}\)/,
    );
  });

  it('tracks the row in every expression the runtime evaluates reactively', () => {
    const { code } = compileTemplate(
      '<li u-for="it in items()" :class="it.cls" u-show="it.vis"><b u-html="it.body"></b><i u-if="it.on">{{ it.n }}</i></li>',
    );
    const track = code.match(/const (_track\d+) =/)?.[1] as string;
    expect(track).toBeTruthy();
    expect(code).toMatch(
      new RegExp(`setAttr\\(_el\\d+, 'class', \\(${track}\\(\\), it\\.cls\\)\\)`),
    );
    expect(code).toMatch(
      new RegExp(`setShow\\(_el\\d+, \\(\\) => \\(${track}\\(\\), it\\.vis\\)\\)`),
    );
    expect(code).toMatch(
      new RegExp(`setSafeHtml\\(_el\\d+, \\(\\) => \\(${track}\\(\\), it\\.body\\)\\)`),
    );
    expect(code).toContain(`Boolean((${track}(), it.on))`);
    expect(code).toContain(`String((${track}(), it.n))`);
  });

  it('leaves the :key and event handlers untracked', () => {
    const { code } = compileTemplate(
      '<li u-for="it in items()" :key="it.id" @click="() => pick(it)">{{ it.n }}</li>',
    );
    // the key runs against the item createFor is placing, not the row's
    // current one, and it takes the raw parameters.
    expect(code).toMatch(/, \(it, _index\) => it\.id\)/);
    // a handler is not evaluated in an effect; it reads the rebound parameter
    // at call time, so tracking it would only add a wasted subscription — and
    // wrapping it would break the compiler's arrow-vs-expression detection.
    expect(code).toMatch(/addEventListener\(_el\d+, 'click', \(\) => pick\(it\)\)/);
  });

  it('tracks every enclosing row from a nested loop', () => {
    const { code } = compileTemplate(
      '<ul><li u-for="g in groups()" :key="g.id"><b u-for="c in g.kids" :key="c.id">{{ g.label }}{{ c.n }}</b></li></ul>',
    );
    const tracks = [...code.matchAll(/const (_track\d+) =/g)].map((m) => m[1]);
    expect(tracks.length).toBe(2);
    const [outer, inner] = tracks;
    // the inner list expression reads the outer row, so replacing the outer
    // item re-reconciles the inner list against its new children.
    expect(code).toMatch(
      new RegExp(`createFor\\(_el\\d+, \\(\\) => \\(${outer}\\(\\), g\\.kids\\)`),
    );
    // and expressions in the inner row read BOTH rows: an inner list that
    // never mentions the outer variable would otherwise leave a binding on
    // the outer one stale.
    expect(code).toContain(`String((${outer}(), ${inner}(), g.label))`);
    expect(code).toContain(`String((${outer}(), ${inner}(), c.n))`);
  });

  it('adds nothing at all outside a u-for', () => {
    const { code } = compileTemplate(
      '<div :class="c()" u-if="show()">{{ msg() }}<button @click="go">x</button></div>',
    );
    expect(code).not.toContain('_track');
    expect(code).not.toContain('_scope');
    expect(code).toContain('String(msg())');
    expect(code).toContain("setAttr(_el2, 'class', c())");
  });

  it('emits a parseable module for every shape of row', () => {
    const templates = [
      '<li u-for="i in items()">{{ i }}</li>',
      '<li u-for="(i, n) in items()" :key="i.id">{{ n }}{{ i.a ? i.b : i.c }}</li>',
      '<ul><li u-for="a in x()" :key="a.id"><b u-for="c in a.kids" :key="c.id">{{ a.n }}{{ c.n }}</b></li></ul>',
      '<li u-for="i in items()" :class="{ on: i.active }" :style="{ color: i.c }">{{ `${i.a}-${i.b}` }}</li>',
      '<li u-for="i in items()"><span u-if="i.a">A</span><span u-else-if="i.b">B</span><span u-else>C</span></li>',
      '<li u-for="i in items()"><Child :item="i" @pick="() => pick(i)" /></li>',
      '<li u-for="i in items()" @click.prevent.stop="remove(i.id)"><input u-model="name" :value="i.v" /></li>',
    ];
    const free = ['items', 'x', 'name', 'pick', 'remove', 'Child'];
    for (const tpl of templates) {
      const { code } = compileTemplate(tpl);
      const helpers = (code.match(/import \{ ([^}]*) \}/)?.[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const body = code.replace(/^import[^\n]*\n/, '');
      expect(
        () => new Function(...helpers, ...free, `${body}\nreturn __render`),
        `failed to parse: ${tpl}`,
      ).not.toThrow();
    }
  });
});

// ===========================================================================
// Structural directives — generated code must execute against the runtime
// ===========================================================================

describe('structural directive codegen — runtime execution', () => {
  it('escapes newlines in static attribute values (emitted module stays valid JS)', () => {
    const result = compileTemplate('<div title="line1\nline2">x</div>');
    // A raw newline inside the quoted string would be a syntax error.
    expect(result.code).toContain("'line1\\nline2'");
    const el = executeRender(result.code) as HTMLElement;
    expect(el.getAttribute('title')).toBe('line1\nline2');
  });

  it('escapes carriage returns in static attribute values', () => {
    const result = compileTemplate('<div title="a\r\nb">x</div>');
    expect(result.code).toContain("'a\\r\\nb'");
    const el = executeRender(result.code) as HTMLElement;
    expect(el.getAttribute('title')).toBe('a\r\nb');
  });

  it('u-if + u-for on the same element renders the list only when the condition holds', async () => {
    const result = compileTemplate(
      '<div><span u-if="cond()" u-for="i in list()">{{ i }}</span></div>',
    );
    // The u-for becomes the createIf's true branch, so the list is only ever
    // built while the condition holds.
    expect(result.code).toContain('createIf(');
    expect(result.code).toContain('createFor(');
    const shown = executeRenderInto(result.code, {
      cond: () => true,
      list: () => ['a', 'b'],
    });
    await tick();
    expect(shown.textContent).toBe('ab');
    const hidden = executeRenderInto(result.code, {
      cond: () => false,
      list: () => ['a', 'b'],
    });
    await tick();
    expect(hidden.textContent).toBe('');
  });

  it('a u-for branch of an else-if chain renders only when its guard holds', async () => {
    const result = compileTemplate(
      '<div><p u-if="a()">A</p><li u-else-if="b()" u-for="i in list()">{{ i }}</li></div>',
    );
    const el = executeRenderInto(result.code, {
      a: () => false,
      b: () => true,
      list: () => [1, 2, 3],
    });
    await tick();
    expect(el.textContent).toBe('123');
    const el2 = executeRenderInto(result.code, {
      a: () => true,
      b: () => true,
      list: () => [1, 2, 3],
    });
    await tick();
    expect(el2.textContent).toBe('A');
  });

  it('u-else-if chains react to signal changes', async () => {
    const a = signal(true);
    const b = signal(false);
    const result = compileTemplate(
      '<div><span u-if="a()">A</span><span u-else-if="b()">B</span><span u-else>C</span></div>',
    );
    const el = executeRenderInto(result.code, { a, b });
    await tick();
    expect(el.textContent).toBe('A');
    a.set(false);
    await tick();
    expect(el.textContent).toBe('C');
    b.set(true);
    await tick();
    expect(el.textContent).toBe('B');
  });

  it('renders a root-level u-if once its anchor is attached', async () => {
    const result = compileTemplate('<div u-if="s()">hi</div>');
    const root = executeRenderInto(result.code, { s: () => true });
    await tick();
    expect(root.textContent).toBe('hi');
  });

  it('renders a root-level u-for once its anchor is attached', async () => {
    // createFor's first reconcile runs before the caller has attached the
    // anchor; without its microtask retry the list rendered nothing at all.
    const result = compileTemplate('<li u-for="i in list()">{{ i }}</li>');
    const root = executeRenderInto(result.code, { list: () => ['x', 'y'] });
    await tick();
    expect(root.textContent).toBe('xy');
  });

  it('root-level u-if reacts to later signal changes', async () => {
    const s = signal(false);
    const result = compileTemplate('<div u-if="s()">hi</div>');
    const root = executeRenderInto(result.code, { s });
    await tick();
    expect(root.textContent).toBe('');
    s.set(true);
    await tick();
    expect(root.textContent).toBe('hi');
  });

  it('a structural directive inside a component slot still renders', async () => {
    const result = compileTemplate('<div><Card><p u-if="x()">hi</p></Card></div>');
    expect(result.code).toContain('createIf(');
    const Card = {
      render(ctx: Record<string, unknown>) {
        const section = document.createElement('section');
        const slots = ctx.$slots as Record<string, () => Node>;
        section.appendChild(slots.default());
        return section;
      },
    };
    const host = executeRenderInto(result.code, { Card, x: () => true });
    await tick();
    expect(host.textContent).toBe('hi');
  });

  it('nested u-if inside u-for item still works', () => {
    const result = compileTemplate(
      '<ul><li u-for="i in list()"><b u-if="i.ok">{{ i.v }}</b></li></ul>',
    );
    const el = executeRender(result.code, {
      list: () => [
        { ok: true, v: 1 },
        { ok: false, v: 2 },
        { ok: true, v: 3 },
      ],
    }) as HTMLElement;
    expect(el.textContent).toBe('13');
  });

  it('u-if/u-else toggles between branches', () => {
    const s = signal(true);
    const result = compileTemplate('<div><b u-if="s()">yes</b><i u-else>no</i></div>');
    const el = executeRender(result.code, { s }) as HTMLElement;
    expect(el.textContent).toBe('yes');
    s.set(false);
    expect(el.textContent).toBe('no');
  });
});

// ===========================================================================
// Event modifiers (u-on / @)
// ===========================================================================

describe('event modifier codegen', () => {
  it('.prevent wraps the handler with preventDefault', () => {
    const result = compileTemplate('<button @click.prevent="go">x</button>');
    expect(result.code).toContain('_e.preventDefault()');
    expect(result.code).toContain('(go)(_e)');
  });

  it('.stop wraps the handler with stopPropagation', () => {
    const result = compileTemplate('<button @click.stop="go">x</button>');
    expect(result.code).toContain('_e.stopPropagation()');
  });

  it('.self guards on event target', () => {
    const result = compileTemplate('<div @click.self="go">x</div>');
    expect(result.code).toContain('if (_e.target !== _e.currentTarget) return');
  });

  it('.once/.capture/.passive become addEventListener options', () => {
    const result = compileTemplate('<button @click.once.capture.passive="go">x</button>');
    expect(result.code).toContain('{ once: true, capture: true, passive: true }');
    // No wrapper needed for a plain handler reference with only option mods.
    expect(result.code).toContain("'click', go, {");
  });

  it('modifier-only handler without expression still emits guards', () => {
    const result = compileTemplate('<form @submit.prevent>x</form>');
    expect(result.code).toContain('(_e) => { _e.preventDefault() }');
  });

  it('inline expression with modifiers is wrapped and $event is replaced', () => {
    const result = compileTemplate('<button @click.stop="count.set($event.detail)">x</button>');
    expect(result.code).toContain('_e.stopPropagation()');
    expect(result.code).toContain('count.set(_e.detail)');
    expect(result.code).not.toContain('$event');
  });

  it('inline expression without modifiers is deferred in an arrow wrapper', () => {
    const result = compileTemplate('<button @click="count.set(count() + 1)">x</button>');
    expect(result.code).toContain('(_e) => { count.set(count() + 1) }');
  });

  it('an arrow-function handler is passed through unwrapped', () => {
    const result = compileTemplate('<button @click="(e) => go(e)">x</button>');
    expect(result.code).toContain("'click', (e) => go(e))");
  });

  it('executes: .prevent handler receives the event and prevents default', () => {
    const result = compileTemplate('<button @click.prevent="onClick">x</button>');
    const calls: Event[] = [];
    const el = executeRender(result.code, {
      onClick: (e: Event) => calls.push(e),
    }) as HTMLElement;
    const event = new Event('click', { cancelable: true });
    el.dispatchEvent(event);
    expect(calls).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
  });
});

// ===========================================================================
// Slots
// ===========================================================================

describe('slot codegen', () => {
  it('renders the default slot from _ctx.$slots', () => {
    const result = compileTemplate('<div><slot /></div>');
    expect(result.code).toContain("_ctx.$slots['default']");
    const el = executeRender(
      result.code,
      {},
      { $slots: { default: () => document.createTextNode('slotted') } },
    ) as HTMLElement;
    expect(el.textContent).toBe('slotted');
  });

  it('falls back to _ctx.children for the default slot', () => {
    const result = compileTemplate('<div><slot /></div>');
    const child = document.createElement('span');
    child.textContent = 'kid';
    const el = executeRender(result.code, {}, { children: child }) as HTMLElement;
    expect(el.textContent).toBe('kid');
  });

  it('renders a comment placeholder when no slot content is provided', () => {
    const result = compileTemplate('<div><slot /></div>');
    const el = executeRender(result.code) as HTMLElement;
    expect(el.childNodes).toHaveLength(1);
    expect(el.childNodes[0].nodeType).toBe(8); // comment
  });

  it('renders a named slot', () => {
    const result = compileTemplate('<div><slot name="header" /></div>');
    expect(result.code).toContain("_ctx.$slots['header']");
    const el = executeRender(
      result.code,
      {},
      { $slots: { header: () => document.createTextNode('H') } },
    ) as HTMLElement;
    expect(el.textContent).toBe('H');
  });

  it('a named slot without content renders a comment placeholder', () => {
    const result = compileTemplate('<div><slot name="header" /></div>');
    const el = executeRender(result.code) as HTMLElement;
    expect(el.childNodes[0].nodeType).toBe(8);
  });
});

// ===========================================================================
// Component codegen
// ===========================================================================

describe('component codegen', () => {
  it('passes boolean attributes as true props', () => {
    const result = compileTemplate('<Widget flag />');
    expect(result.code).toContain("'flag': true");
  });

  it('passes bound props as expressions', () => {
    const result = compileTemplate('<Widget :count="n()" />');
    expect(result.code).toContain("'count': n()");
  });

  it('compiles a single element child into a default slot factory', () => {
    const result = compileTemplate('<Card><p>hello</p></Card>');
    expect(result.code).toContain('{ default:');
    expect(result.code).toContain("createElement('p')");
  });

  it('wraps multiple slot children in a div', () => {
    const result = compileTemplate('<Card><p>a</p><p>b</p></Card>');
    expect(result.code).toContain("createElement('div')");
    expect(result.code).toContain('{ default:');
  });

  it('wraps interpolation-only slot content in a div', () => {
    const result = compileTemplate('<Card>{{ msg() }}</Card>');
    expect(result.code).toContain("createElement('div')");
    expect(result.code).toContain('setText');
  });

  it('wraps text-only slot content in a div', () => {
    const result = compileTemplate('<Card>hello</Card>');
    expect(result.code).toContain("createElement('div')");
    expect(result.code).toContain('createTextNode("hello")');
  });

  it('components without children get no slots argument', () => {
    const result = compileTemplate('<Card title="x" />');
    expect(result.code).toContain("createComponent(Card, { 'title': 'x' })");
  });
});

// ===========================================================================
// Template parser — error paths and rare syntax
// ===========================================================================

describe('template parser edge cases', () => {
  it('throws on unterminated comment', () => {
    expect(() => parseTemplate('<div><!-- oops</div>')).toThrow(/[Uu]nterminated comment/);
  });

  it('throws on unterminated quoted attribute value', () => {
    expect(() => parseTemplate('<div class="foo>x</div>')).toThrow(/[Uu]nterminated attribute/);
  });

  it('parses unquoted attribute values', () => {
    const ast = parseTemplate('<div class=foo>x</div>');
    const el = ast[0] as ElementNode;
    expect(el.attrs[0]).toEqual({ name: 'class', value: 'foo' });
  });

  it('throws with line/column info for errors after newlines', () => {
    expect(() => parseTemplate('<div>\n{{ oops</div>')).toThrow(/at 2:/);
  });

  it('throws when attribute list hits a character that is not an attribute', () => {
    expect(() => parseTemplate('<div "bad">x</div>')).toThrow(/Expected/);
  });

  it('throws when the source ends inside a tag', () => {
    expect(() => parseTemplate('<div foo')).toThrow(/Expected/);
  });

  it('treats a stray < in text as literal text', () => {
    const ast = parseTemplate('<p>a < b</p>');
    const p = ast[0] as ElementNode;
    expect((p.children[0] as TextNode).content).toBe('a < b');
  });

  it('ignores }} inside single-quoted strings in interpolations', () => {
    const ast = parseTemplate("<p>{{ fn('}}') }}</p>");
    const p = ast[0] as ElementNode;
    expect(p.children[0]).toMatchObject({ type: 3, expression: "fn('}}')" });
  });

  it('ignores }} inside double-quoted strings in interpolations', () => {
    const ast = parseTemplate('<p>{{ fn("}}") }}</p>');
    const p = ast[0] as ElementNode;
    expect(p.children[0]).toMatchObject({ type: 3, expression: 'fn("}}")' });
  });

  it('ignores }} inside template literals in interpolations', () => {
    const ast = parseTemplate('<p>{{ fn(`}}`) }}</p>');
    const p = ast[0] as ElementNode;
    expect(p.children[0]).toMatchObject({ type: 3, expression: 'fn(`}}`)' });
  });

  it('handles escaped quotes inside interpolation strings', () => {
    const ast = parseTemplate("<p>{{ fn('a\\'}}b') }}</p>");
    const p = ast[0] as ElementNode;
    expect(p.children[0]).toMatchObject({ type: 3, expression: "fn('a\\'}}b')" });
  });

  it('throws on an interpolation left open inside a string', () => {
    // The single quote swallows the }} so the interpolation never terminates.
    expect(() => parseTemplate("<p>{{ fn('}}oops</p>")).toThrow(/[Uu]nterminated/);
  });

  it('treats unknown u- names as plain attributes', () => {
    const ast = parseTemplate('<div u-custom="x">y</div>');
    const el = ast[0] as ElementNode;
    expect(el.directives).toHaveLength(0);
    expect(el.attrs).toContainEqual({ name: 'u-custom', value: 'x' });
  });

  it('u-bind without an argument defaults to the value attribute', () => {
    const result = compileTemplate('<input u-bind="v()" />');
    expect(result.code).toContain("setAttr(_el0, 'value', v())");
  });
});

// ===========================================================================
// Codegen edge cases
// ===========================================================================

describe('codegen edge cases', () => {
  it('compiles an empty template to an empty div', () => {
    const result = compileTemplate('');
    expect(result.code).toContain("const _root = createElement('div')");
    expect(result.code).toContain('return _root');
  });

  it('applies the scope id to the wrapper div for multi-root templates', () => {
    const result = compileTemplate('<p>a</p><p>b</p>', { scopeId: 'data-u-x' });
    const setScopeCalls = result.code.match(/setAttr\([^,]+, 'data-u-x', ''\)/g);
    expect(setScopeCalls).toHaveLength(3); // wrapper + both roots
  });

  it('skips HTML comments inside elements', () => {
    const result = compileTemplate('<div><!-- note --><span>x</span></div>');
    expect(result.code).not.toContain('note');
    expect(result.code).toContain("createElement('span')");
  });

  it('emits boolean attributes as empty-string setAttr calls', () => {
    const result = compileTemplate('<input disabled />');
    expect(result.code).toContain("setAttr(_el0, 'disabled', '')");
  });

  it('throws on an invalid u-for expression', () => {
    expect(() => compileTemplate('<li u-for="wat">x</li>')).toThrow(/Invalid u-for expression/);
  });

  it('supports (item, index) destructuring in u-for', () => {
    const result = compileTemplate('<li u-for="(item, i) in items()">{{ i }}: {{ item }}</li>');
    expect(result.code).toContain('(item, i, ');
  });

  it('passes a :key binding through as the key function', () => {
    const result = compileTemplate('<li u-for="item in items()" :key="item.id">{{ item.v }}</li>');
    expect(result.code).toContain('(item, _index) => item.id)');
    // :key must not be emitted as an attribute binding on the element.
    expect(result.code).not.toContain("setAttr(_el1, 'key'");
  });

  it('an empty bound expression compiles to an empty string literal', () => {
    const result = compileTemplate('<input :value="" />');
    expect(result.code).toContain("setAttr(_el0, 'value', '')");
  });
});

// ===========================================================================
// Entity decoding — hex and named forms
// ===========================================================================

describe('entity decoding — hex and named', () => {
  it('decodes hex entities', () => {
    const result = compileTemplate('<p>&#x41;&#x62;</p>');
    expect(result.code).toContain('"Ab"');
  });

  it('preserves out-of-range hex entities', () => {
    const result = compileTemplate('<p>&#x110000;</p>');
    expect(result.code).toContain('&#x110000;');
  });

  it('decodes known named entities', () => {
    const result = compileTemplate('<p>&amp;&nbsp;&copy;</p>');
    expect(result.code).toContain(JSON.stringify('& ©'));
  });

  it('preserves unknown named entities verbatim', () => {
    const result = compileTemplate('<p>&doesnotexist;</p>');
    expect(result.code).toContain('&doesnotexist;');
  });
});

// ===========================================================================
// Style compiler — preprocessing and edge cases
// ===========================================================================

describe('style preprocessing (scss/sass)', () => {
  it('compiles scss nesting to plain css', () => {
    const out = preprocessStyle('.a { .b { color: red; } }', 'scss', 'test.utopia');
    expect(out).toContain('.a .b');
    expect(out).toContain('color: red');
  });

  it('compiles indented sass syntax', () => {
    const out = preprocessStyle('.a\n  color: red', 'sass', 'test.utopia');
    expect(out).toContain('.a {');
    expect(out).toContain('color: red');
  });

  it('passes through plain css and undefined lang unchanged', () => {
    expect(preprocessStyle('.a { color: red; }', 'css', 'x')).toBe('.a { color: red; }');
    expect(preprocessStyle('.a { color: red; }', undefined, 'x')).toBe('.a { color: red; }');
  });

  it('throws on unsupported style languages', () => {
    expect(() => preprocessStyle('.a {}', 'less', 'x')).toThrow(/unsupported <style lang="less">/);
  });

  it('integrates with compile(): scoped scss styles', () => {
    const source = `
<template><div class="a"><span class="b">x</span></div></template>
<style lang="scss" scoped>
.a { .b { color: red; } }
</style>
`;
    const result = compile(source, { scopeId: 'data-u-test' });
    expect(result.css).toContain('.a .b[data-u-test]');
  });
});

describe('style compiler edge cases', () => {
  const scoped = (source: string) =>
    compileStyle({ source, filename: 'test.utopia', scoped: true, scopeId: 'data-u-t' });

  it('preserves an unterminated comment', () => {
    expect(scoped('/* trailing comment').css).toBe('/* trailing comment');
  });

  it('keeps stray closing braces', () => {
    expect(scoped('} .a { color: red; }').css).toContain('.a[data-u-t]');
  });

  it('passes statement at-rules through unchanged', () => {
    expect(scoped('@import "base.css";\n.a { color: red; }').css).toContain('@import "base.css";');
  });

  it('returns a malformed at-rule without braces as-is', () => {
    expect(scoped('@media (min-width: 600px)').css).toBe('@media (min-width: 600px)');
  });

  it('keeps trailing text after the last rule', () => {
    expect(scoped('.a { color: red; } .b').css).toContain('.b');
  });

  it('does not lose the last character of an unterminated rule', () => {
    expect(scoped('.a { color: red').css).toBe('.a[data-u-t] { color: red}');
  });

  it('does not lose the last character of an unterminated at-rule body', () => {
    const out = scoped('@media x { .a { color: red }').css;
    expect(out).toContain('color: red');
  });

  it('tracks nested braces inside a rule set', () => {
    const out = scoped('.a { &:hover { color: red; } }').css;
    expect(out).toContain('.a[data-u-t]');
    expect(out).toContain('&:hover');
  });

  it('leaves empty selectors in a group untouched', () => {
    const out = scoped('a, , b { color: red; }').css;
    expect(out).toContain('a[data-u-t]');
    expect(out).toContain('b[data-u-t]');
  });

  it('does not scope inside vendor-prefixed keyframes', () => {
    const out = scoped('@-webkit-keyframes spin { from { opacity: 0; } }').css;
    expect(out).not.toContain('from[data-u-t]');
  });

  it('scopes complex pseudo selectors correctly', () => {
    expect(scoped('li:nth-child(2n) { color: red; }').css).toContain('li[data-u-t]:nth-child(2n)');
  });
});

// ===========================================================================
// compile() — remaining option branches
// ===========================================================================

describe('compile() option branches', () => {
  it('compiles an SFC with no template block', () => {
    const result = compile('<script>const x = 1</script>');
    expect(result.code).toContain('const x = 1');
    expect(result.code).toContain('export default { render: __render }');
  });

  it('treats a boolean lang attribute as plain css', () => {
    const source = `
<template><div class="a">x</div></template>
<style lang scoped>
.a { color: red; }
</style>
`;
    const result = compile(source, { scopeId: 'data-u-test' });
    expect(result.css).toContain('.a[data-u-test]');
  });

  it('accepts explicit a11y options', () => {
    const result = compile('<template><img src="p.jpg"></template>', {
      a11y: { disable: ['img-alt'] },
    });
    expect(result.a11y).toHaveLength(0);
  });
});

// ===========================================================================
// Degenerate directive combinations
// ===========================================================================

describe('degenerate directive combinations', () => {
  it('u-on without an event argument defaults to click', () => {
    const result = compileTemplate('<button u-on="h">x</button>');
    expect(result.code).toContain("addEventListener(_el0, 'click', h)");
  });

  it('u-else combined with u-if compiles without leaking closure variables', () => {
    // `<p u-else u-if="b()">` is a degenerate combination: the element is
    // consumed as the else branch, and its own u-if compiles inside the else
    // closure. The nested createIf call must stay inside that closure so the
    // module remains semantically valid.
    const result = compileTemplate('<div><p u-if="a()">A</p><p u-else u-if="b()">B</p></div>');
    const nestedIfIdx = result.code.lastIndexOf('createIf(');
    const outerIfIdx = result.code.indexOf('createIf(');
    expect(nestedIfIdx).toBeGreaterThan(outerIfIdx);
    // Executes without ReferenceError.
    const el = executeRender(result.code, { a: () => true, b: () => true }) as HTMLElement;
    expect(el.textContent).toBe('A');
  });

  it('u-else with both u-if and u-for routes through the flat chain', () => {
    const result = compileTemplate(
      '<div><p u-if="a()">A</p><p u-else u-if="b()" u-for="i in list()">{{ i }}</p></div>',
    );
    const el = executeRender(result.code, {
      a: () => true,
      b: () => true,
      list: () => [1],
    }) as HTMLElement;
    expect(el.textContent).toBe('A');
  });
});

// ===========================================================================
// Remaining branch coverage
// ===========================================================================

describe('remaining branches', () => {
  it('ignores unknown u-transition modifiers', () => {
    const result = compileTemplate('<div u-transition:fade.slow>x</div>');
    expect(result.code).toContain("createTransition(_el0, { name: 'fade' })");
  });

  it('non-empty text between u-if and u-else breaks the chain', () => {
    const result = compileTemplate('<div><span u-if="a">A</span>mid<span u-else>B</span></div>');
    // The u-else is orphaned by the intervening text and silently skipped.
    const createIfCount = (result.code.match(/createIf\(/g) || []).length;
    expect(createIfCount).toBe(1);
    expect(result.code).not.toContain('"B"');
    expect(result.code).toContain('"mid"');
  });

  it('a component @event becomes an onX callback prop', () => {
    const result = compileTemplate('<Widget @select="h" />');
    expect(result.code).toContain("'onSelect': h");
  });

  it('a non-bind, non-event directive on a component does not become a prop', () => {
    const result = compileTemplate('<Widget u-show="vis()" />');
    expect(result.code).toContain('createComponent(Widget, {})');
  });
});
