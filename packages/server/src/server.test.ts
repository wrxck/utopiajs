// ============================================================================
// @utopia/server — Test suite
// ============================================================================

import { describe, it, expect } from 'vitest';
import { signal } from '@utopia/core';
import type { VElement, VText, VComment, VNode } from './vnode.js';
import {
  createElement,
  createTextNode,
  createComment,
  setText,
  setAttr,
  addEventListener,
  appendChild,
  insertBefore,
  removeNode,
  effect,
  createEffect,
  createIf,
  createFor,
  createComponent,
  flushStyles,
} from './ssr-runtime.js';
import { renderToString, serializeVNode } from './render-to-string.js';

// =========================================================================
// VNode creation
// =========================================================================

describe('SSR VNode creation', () => {
  it('createElement creates a VElement', () => {
    const el = createElement('div');
    expect(el.type).toBe(1);
    expect(el.tag).toBe('div');
    expect(el.attrs).toEqual({});
    expect(el.children).toEqual([]);
  });

  it('createTextNode creates a VText', () => {
    const text = createTextNode('hello');
    expect(text.type).toBe(2);
    expect(text.text).toBe('hello');
  });

  it('createComment creates a VComment', () => {
    const comment = createComment('anchor');
    expect(comment.type).toBe(3);
    expect(comment.text).toBe('anchor');
  });
});

// =========================================================================
// SSR runtime helpers
// =========================================================================

describe('SSR runtime helpers', () => {
  describe('setText', () => {
    it('sets text on a VText node', () => {
      const node = createTextNode('initial');
      setText(node, 'updated');
      expect(node.text).toBe('updated');
    });

    it('converts null to empty string', () => {
      const node = createTextNode('hello');
      setText(node, null);
      expect(node.text).toBe('');
    });
  });

  describe('setAttr', () => {
    it('sets a plain string attribute', () => {
      const el = createElement('div');
      setAttr(el, 'id', 'main');
      expect(el.attrs['id']).toBe('main');
    });

    it('removes attribute when value is null', () => {
      const el = createElement('div');
      setAttr(el, 'id', 'main');
      setAttr(el, 'id', null);
      expect(el.attrs['id']).toBeUndefined();
    });

    it('handles class as string', () => {
      const el = createElement('div');
      setAttr(el, 'class', 'foo bar');
      expect(el.attrs['class']).toBe('foo bar');
    });

    it('handles class as object', () => {
      const el = createElement('div');
      setAttr(el, 'class', { active: true, hidden: false });
      expect(el.attrs['class']).toBe('active');
    });

    it('handles style as string', () => {
      const el = createElement('div');
      setAttr(el, 'style', 'color: red');
      expect(el.attrs['style']).toBe('color: red');
    });

    it('handles style as object', () => {
      const el = createElement('div');
      setAttr(el, 'style', { color: 'red', fontSize: '14px' });
      expect(el.attrs['style']).toBe('color: red; font-size: 14px');
    });

    it('handles boolean attributes (truthy)', () => {
      const el = createElement('input');
      setAttr(el, 'disabled', true);
      expect(el.attrs['disabled']).toBe('');
    });

    it('handles boolean attributes (falsy)', () => {
      const el = createElement('input');
      setAttr(el, 'disabled', true);
      setAttr(el, 'disabled', false);
      expect(el.attrs['disabled']).toBeUndefined();
    });

    it('sets value=true to empty string for non-boolean attrs', () => {
      const el = createElement('div');
      setAttr(el, 'aria-hidden', true);
      expect(el.attrs['aria-hidden']).toBe('');
    });
  });

  describe('addEventListener', () => {
    it('is a no-op and returns a cleanup function', () => {
      const el = createElement('button');
      const cleanup = addEventListener(el, 'click', () => {});
      expect(typeof cleanup).toBe('function');
      cleanup(); // should not throw
    });
  });

  describe('appendChild', () => {
    it('appends a child and sets _parent', () => {
      const parent = createElement('ul');
      const child = createElement('li');
      appendChild(parent, child);
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0]).toBe(child);
      expect(child._parent).toBe(parent);
    });
  });

  describe('insertBefore', () => {
    it('inserts before the anchor', () => {
      const parent = createElement('div');
      const anchor = createComment('anchor');
      appendChild(parent, anchor);
      const node = createElement('span');
      insertBefore(parent, node, anchor);
      expect(parent.children[0]).toBe(node);
      expect(parent.children[1]).toBe(anchor);
    });

    it('appends when anchor is null', () => {
      const parent = createElement('div');
      const existing = createElement('p');
      appendChild(parent, existing);
      const node = createElement('span');
      insertBefore(parent, node, null);
      expect(parent.children[1]).toBe(node);
    });
  });

  describe('removeNode', () => {
    it('removes a node from its parent', () => {
      const parent = createElement('div');
      const child = createElement('span');
      appendChild(parent, child);
      removeNode(child);
      expect(parent.children).toHaveLength(0);
      expect(child._parent).toBeUndefined();
    });

    it('is a no-op when node has no parent', () => {
      const orphan = createElement('div');
      expect(() => removeNode(orphan)).not.toThrow();
    });
  });

  describe('effect / createEffect', () => {
    it('runs the function once synchronously', () => {
      let count = 0;
      effect(() => { count++; });
      expect(count).toBe(1);
    });

    it('does not track dependencies', () => {
      const s = signal(0);
      let count = 0;
      effect(() => { s(); count++; });
      expect(count).toBe(1);
      s.set(1);
      // Should NOT re-run on server
      expect(count).toBe(1);
    });

    it('createEffect is an alias for effect', () => {
      let count = 0;
      createEffect(() => { count++; });
      expect(count).toBe(1);
    });
  });

  describe('createIf', () => {
    it('renders true branch when condition is truthy', () => {
      const parent = createElement('div');
      const anchor = createComment('u-if');
      appendChild(parent, anchor);

      createIf(
        anchor,
        () => true,
        () => {
          const el = createElement('span');
          return el;
        },
      );

      // span should be before the anchor
      expect(parent.children).toHaveLength(2);
      expect((parent.children[0] as VElement).tag).toBe('span');
    });

    it('renders false branch when condition is falsy', () => {
      const parent = createElement('div');
      const anchor = createComment('u-if');
      appendChild(parent, anchor);

      createIf(
        anchor,
        () => false,
        () => createElement('span'),
        () => createElement('em'),
      );

      expect(parent.children).toHaveLength(2);
      expect((parent.children[0] as VElement).tag).toBe('em');
    });

    it('renders nothing when condition is falsy and no false branch', () => {
      const parent = createElement('div');
      const anchor = createComment('u-if');
      appendChild(parent, anchor);

      createIf(
        anchor,
        () => false,
        () => createElement('span'),
      );

      expect(parent.children).toHaveLength(1);
      expect(parent.children[0]).toBe(anchor);
    });
  });

  describe('createFor', () => {
    it('renders all items in the list', () => {
      const parent = createElement('ul');
      const anchor = createComment('u-for');
      appendChild(parent, anchor);

      createFor(
        anchor,
        () => ['a', 'b', 'c'],
        (item, index) => {
          const li = createElement('li');
          const text = createTextNode(`${index}: ${item}`);
          appendChild(li, text);
          return li;
        },
      );

      // 3 li + 1 anchor
      expect(parent.children).toHaveLength(4);
      expect((parent.children[0] as VElement).tag).toBe('li');
      expect(((parent.children[0] as VElement).children[0] as VText).text).toBe('0: a');
      expect(((parent.children[2] as VElement).children[0] as VText).text).toBe('2: c');
    });
  });

  describe('createComponent', () => {
    it('creates and renders a component', () => {
      const def = {
        setup: (props: any) => ({ msg: props.msg ?? 'default' }),
        render: (ctx: any) => {
          const el = createElement('p');
          const text = createTextNode(ctx.msg);
          appendChild(el, text);
          return el;
        },
      };

      const node = createComponent(def, { msg: 'hello' }) as VElement;
      expect(node.type).toBe(1);
      expect(node.tag).toBe('p');
      expect((node.children[0] as VText).text).toBe('hello');
    });

    it('collects styles', () => {
      flushStyles();
      const def = {
        render: () => createElement('div'),
        styles: '.scoped { color: red; }',
      };

      createComponent(def);
      const styles = flushStyles();
      expect(styles).toEqual(['.scoped { color: red; }']);
    });
  });
});

// =========================================================================
// VNode serialization
// =========================================================================

describe('VNode serialization', () => {
  it('serializes a simple element', () => {
    const el = createElement('div');
    expect(serializeVNode(el)).toBe('<div></div>');
  });

  it('serializes attributes', () => {
    const el = createElement('div');
    setAttr(el, 'class', 'foo');
    setAttr(el, 'id', 'main');
    expect(serializeVNode(el)).toBe('<div class="foo" id="main"></div>');
  });

  it('serializes boolean attributes', () => {
    const el = createElement('input');
    setAttr(el, 'disabled', true);
    expect(serializeVNode(el)).toBe('<input disabled>');
  });

  it('serializes void elements without closing tag', () => {
    const el = createElement('br');
    expect(serializeVNode(el)).toBe('<br>');
  });

  it('serializes nested elements', () => {
    const div = createElement('div');
    const span = createElement('span');
    const text = createTextNode('hello');
    appendChild(span, text);
    appendChild(div, span);
    expect(serializeVNode(div)).toBe('<div><span>hello</span></div>');
  });

  it('escapes HTML in text nodes', () => {
    const text = createTextNode('<script>alert("xss")</script>');
    expect(serializeVNode(text)).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('escapes quotes in attribute values', () => {
    const el = createElement('div');
    setAttr(el, 'title', 'say "hello"');
    expect(serializeVNode(el)).toBe('<div title="say &quot;hello&quot;"></div>');
  });

  it('serializes comment nodes', () => {
    const comment = createComment('u-if');
    expect(serializeVNode(comment)).toBe('<!--u-if-->');
  });

  it('escapes -- sequences in comment text', () => {
    const comment = createComment('bad-->content');
    const html = serializeVNode(comment);
    expect(html).not.toContain('-->content');
    expect(html).toContain('<!--');
    expect(html).toMatch(/-->$/);
  });
});

// =========================================================================
// renderToString integration
// =========================================================================

describe('renderToString', () => {
  it('renders a simple component', () => {
    const Component = {
      render: () => {
        const div = createElement('div');
        setAttr(div, 'class', 'app');
        const text = createTextNode('Hello');
        appendChild(div, text);
        return div;
      },
    };

    const { html, css } = renderToString(Component);
    expect(html).toBe('<div class="app">Hello</div>');
    expect(css).toBe('');
  });

  it('renders with setup and props', () => {
    const Component = {
      setup: (props: any) => ({ name: props.name }),
      render: (ctx: any) => {
        const p = createElement('p');
        const text = createTextNode(ctx.name);
        appendChild(p, text);
        return p;
      },
    };

    const { html } = renderToString(Component, { name: 'World' });
    expect(html).toBe('<p>World</p>');
  });

  it('collects scoped CSS', () => {
    const Component = {
      render: () => createElement('div'),
      styles: '.app { color: red; }',
    };

    const { css } = renderToString(Component);
    expect(css).toBe('.app { color: red; }');
  });

  it('renders conditional content (u-if)', () => {
    const Component = {
      setup: () => ({ show: signal(true) }),
      render: (ctx: any) => {
        const div = createElement('div');
        const anchor = createComment('u-if');
        appendChild(div, anchor);
        createIf(
          anchor,
          () => ctx.show(),
          () => {
            const span = createElement('span');
            appendChild(span, createTextNode('visible'));
            return span;
          },
        );
        return div;
      },
    };

    const { html } = renderToString(Component);
    expect(html).toBe('<div><span>visible</span><!--u-if--></div>');
  });

  it('renders list content (u-for)', () => {
    const Component = {
      setup: () => ({ items: signal(['a', 'b']) }),
      render: (ctx: any) => {
        const ul = createElement('ul');
        const anchor = createComment('u-for');
        appendChild(ul, anchor);
        createFor(
          anchor,
          () => ctx.items(),
          (item: string) => {
            const li = createElement('li');
            appendChild(li, createTextNode(item));
            return li;
          },
        );
        return ul;
      },
    };

    const { html } = renderToString(Component);
    expect(html).toBe('<ul><li>a</li><li>b</li><!--u-for--></ul>');
  });
});
