// ---------------------------------------------------------------------------
// compiler.test.ts — Tests for the @matthesketh/utopia-compiler package
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parse, SFCParseError } from './parser';
import { compileTemplate, parseTemplate } from './template-compiler';
import { compileStyle, generateScopeId } from './style-compiler';
import { compile } from './index';

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
    const div = ast[0] as any;
    expect(div.tag).toBe('div');
    expect(div.children).toHaveLength(1);
    const span = div.children[0];
    expect(span.tag).toBe('span');
    expect(span.children).toHaveLength(1);
    expect(span.children[0]).toMatchObject({ type: 2, content: 'text' });
  });

  it('parses static attributes', () => {
    const ast = parseTemplate('<div class="foo" id="bar"></div>');
    const el = ast[0] as any;
    expect(el.attrs).toEqual([
      { name: 'class', value: 'foo' },
      { name: 'id', value: 'bar' },
    ]);
  });

  it('parses boolean attributes', () => {
    const ast = parseTemplate('<input disabled />');
    const el = ast[0] as any;
    expect(el.attrs).toEqual([{ name: 'disabled', value: null }]);
    expect(el.selfClosing).toBe(true);
  });

  it('parses single-quoted attribute values', () => {
    const ast = parseTemplate("<div class='foo'></div>");
    const el = ast[0] as any;
    expect(el.attrs[0]).toEqual({ name: 'class', value: 'foo' });
  });

  it('parses void elements without explicit self-close', () => {
    const ast = parseTemplate('<br>');
    expect(ast).toHaveLength(1);
    const el = ast[0] as any;
    expect(el.tag).toBe('br');
    expect(el.selfClosing).toBe(true);
  });

  it('parses self-closing tags', () => {
    const ast = parseTemplate('<img src="x.png" />');
    expect(ast).toHaveLength(1);
    const el = ast[0] as any;
    expect(el.tag).toBe('img');
    expect(el.selfClosing).toBe(true);
    expect(el.attrs).toEqual([{ name: 'src', value: 'x.png' }]);
  });

  it('parses text interpolation', () => {
    const ast = parseTemplate('<p>Hello {{ name() }}</p>');
    const p = ast[0] as any;
    expect(p.children).toHaveLength(2);
    expect(p.children[0]).toMatchObject({ type: 2, content: 'Hello ' });
    expect(p.children[1]).toMatchObject({ type: 3, expression: 'name()' });
  });

  it('parses multiple interpolations in text', () => {
    const ast = parseTemplate('<p>{{ a() }} and {{ b() }}</p>');
    const p = ast[0] as any;
    expect(p.children).toHaveLength(3);
    expect(p.children[0]).toMatchObject({ type: 3, expression: 'a()' });
    expect(p.children[1]).toMatchObject({ type: 2, content: ' and ' });
    expect(p.children[2]).toMatchObject({ type: 3, expression: 'b()' });
  });

  it('parses @click event shorthand', () => {
    const ast = parseTemplate('<button @click="handler">Go</button>');
    const btn = ast[0] as any;
    expect(btn.directives).toHaveLength(1);
    expect(btn.directives[0]).toMatchObject({
      kind: 'on',
      arg: 'click',
      expression: 'handler',
    });
  });

  it('parses u-on:event directive', () => {
    const ast = parseTemplate('<button u-on:click="handler">Go</button>');
    const btn = ast[0] as any;
    expect(btn.directives).toHaveLength(1);
    expect(btn.directives[0]).toMatchObject({
      kind: 'on',
      arg: 'click',
      expression: 'handler',
    });
  });

  it('parses :attr bind shorthand', () => {
    const ast = parseTemplate('<input :value="name()" />');
    const el = ast[0] as any;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0]).toMatchObject({
      kind: 'bind',
      arg: 'value',
      expression: 'name()',
    });
  });

  it('parses u-bind:attr directive', () => {
    const ast = parseTemplate('<input u-bind:value="name()" />');
    const el = ast[0] as any;
    expect(el.directives[0]).toMatchObject({
      kind: 'bind',
      arg: 'value',
      expression: 'name()',
    });
  });

  it('parses u-if directive', () => {
    const ast = parseTemplate('<div u-if="show()">conditional</div>');
    const el = ast[0] as any;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0]).toMatchObject({
      kind: 'if',
      expression: 'show()',
    });
  });

  it('parses u-for directive', () => {
    const ast = parseTemplate('<li u-for="item in items()">{{ item }}</li>');
    const el = ast[0] as any;
    expect(el.directives).toHaveLength(1);
    expect(el.directives[0]).toMatchObject({
      kind: 'for',
      expression: 'item in items()',
    });
  });

  it('parses u-model directive', () => {
    const ast = parseTemplate('<input u-model="name" />');
    const el = ast[0] as any;
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
    const el = ast[0] as any;
    expect(el.tag).toBe('MyComponent');
    expect(el.attrs).toEqual([{ name: 'foo', value: 'bar' }]);
  });

  it('parses deeply nested structures', () => {
    const ast = parseTemplate('<div><ul><li><a href="#">link</a></li></ul></div>');
    const div = ast[0] as any;
    const ul = div.children.find((c: any) => c.type === 1);
    const li = ul.children.find((c: any) => c.type === 1);
    const a = li.children.find((c: any) => c.type === 1);
    expect(a.tag).toBe('a');
    expect(a.attrs[0]).toEqual({ name: 'href', value: '#' });
    expect(a.children.find((c: any) => c.type === 2).content).toBe('link');
  });

  it('parses event modifier syntax', () => {
    const ast = parseTemplate('<button @click.prevent="handler">Go</button>');
    const btn = ast[0] as any;
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
    // The item should be a function parameter.
    expect(result.code).toContain('(item, _index)');
    // Inside the for body, `item` should be used directly.
    expect(result.code).toContain('String(item)');
    expect(result.helpers.has('createFor')).toBe(true);
    expect(result.helpers.has('createComment')).toBe(true);
  });

  it('compiles u-model with two-way binding', () => {
    const result = compileTemplate('<input u-model="name" />');
    // Bind direction: reactive attribute.
    expect(result.code).toContain('setAttr(');
    expect(result.code).toContain("'value'");
    expect(result.code).toContain('name()');
    // Event direction: set on input.
    expect(result.code).toContain('addEventListener(');
    expect(result.code).toContain("'input'");
    expect(result.code).toContain('name.set(');
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
    expect(result.code).toContain('(item, _index)');
    expect(result.code).toContain('String(item)');
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
