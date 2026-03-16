// ============================================================================
// @matthesketh/utopia-server — Test suite
// ============================================================================

import { describe, it, expect } from 'vitest';
import { signal } from '@matthesketh/utopia-core';
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
  createForm,
  required,
  minLength,
  maxLength,
  min,
  max,
  email,
  pattern,
  validate,
  pushDisposer,
  startCapturingDisposers,
  stopCapturingDisposers,
  useHead,
} from './ssr-runtime.js';
import { renderToString, serializeVNode, serializeHead } from './render-to-string.js';
import { renderToStream } from './render-to-stream.js';
import { createServerRouter } from './server-router.js';

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
      effect(() => {
        count++;
      });
      expect(count).toBe(1);
    });

    it('does not track dependencies', () => {
      const s = signal(0);
      let count = 0;
      effect(() => {
        s();
        count++;
      });
      expect(count).toBe(1);
      s.set(1);
      // Should NOT re-run on server
      expect(count).toBe(1);
    });

    it('createEffect is an alias for effect', () => {
      let count = 0;
      createEffect(() => {
        count++;
      });
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
        setup: (props: Record<string, unknown>) => ({ msg: props.msg ?? 'default' }),
        render: (ctx: Record<string, unknown>) => {
          const el = createElement('p');
          const text = createTextNode(String(ctx.msg));
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
      setup: (props: Record<string, unknown>) => ({ name: props.name }),
      render: (ctx: Record<string, unknown>) => {
        const p = createElement('p');
        const text = createTextNode(String(ctx.name));
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
      render: (ctx: Record<string, unknown>) => {
        const div = createElement('div');
        const anchor = createComment('u-if');
        appendChild(div, anchor);
        createIf(
          anchor,
          () => (ctx.show as () => boolean)(),
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
      render: (ctx: Record<string, unknown>) => {
        const ul = createElement('ul');
        const anchor = createComment('u-for');
        appendChild(ul, anchor);
        createFor(
          anchor,
          () => (ctx.items as () => string[])(),
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

// =========================================================================
// Security validation tests
// =========================================================================

describe('Security: tag name validation', () => {
  it('throws on invalid tag name containing injected attributes', () => {
    const maliciousTag = 'div onclick="alert(1)"';
    const node: VElement = {
      type: 1,
      tag: maliciousTag,
      attrs: {},
      children: [],
    };
    expect(() => serializeVNode(node)).toThrow('Invalid tag name');
  });
});

describe('Security: attribute name validation', () => {
  it('throws on invalid attribute name with injection attempt', () => {
    const node: VElement = {
      type: 1,
      tag: 'div',
      attrs: { '" onload="alert(1)': 'x' },
      children: [],
    };
    expect(() => serializeVNode(node)).toThrow('Invalid attribute name');
  });
});

describe('Security: CSS injection prevention', () => {
  it('escapes closing style tags in CSS content via renderToStream', async () => {
    const maliciousCSS = "</style><script>alert('xss')</script>";
    const Component = {
      render: () => createElement('div'),
      styles: maliciousCSS,
    };

    const stream = renderToStream(Component);
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk.toString());
    }
    const output = chunks.join('');
    // The raw </style> should be escaped to <\/style
    expect(output).toContain('<\\/style');
    expect(output).not.toMatch(/<\/style><script>/);
  });
});

describe('Security: template marker safety', () => {
  it('CSS with replace() special characters ($1, $&) is inserted correctly', async () => {
    const trickyCss = 'body { content: "$1 $& $$"; }';
    const Component = {
      render: () => createElement('div'),
      styles: trickyCss,
    };

    const stream = renderToStream(Component);
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk.toString());
    }
    const output = chunks.join('');
    expect(output).toContain('$1 $& $$');
  });
});

describe('Security: malformed URL handling in createServerRouter', () => {
  it('returns null for garbage URL input', () => {
    const routes = [
      {
        path: '/',
        pattern: /^\/$/,
        params: [],
        component: () => Promise.resolve({}),
      },
    ];
    // http://[::1 causes the URL constructor to throw
    const result = createServerRouter(routes, 'http://[::1');
    expect(result).toBeNull();
  });
});

describe('Security: valid tags pass through validation', () => {
  it('allows standard HTML tags', () => {
    const div: VElement = { type: 1, tag: 'div', attrs: {}, children: [] };
    expect(() => serializeVNode(div)).not.toThrow();

    const span: VElement = { type: 1, tag: 'span', attrs: {}, children: [] };
    expect(() => serializeVNode(span)).not.toThrow();
  });

  it('allows custom element / web component tags', () => {
    const custom: VElement = { type: 1, tag: 'my-component', attrs: {}, children: [] };
    const html = serializeVNode(custom);
    expect(html).toBe('<my-component></my-component>');
  });
});

// =========================================================================
// SSR form validation stubs
// =========================================================================

describe('SSR form validation stubs', () => {
  it('createForm returns static form with initial values', () => {
    const form = createForm({
      name: { initial: 'Matt', rules: [required()] },
      age: { initial: 25 },
    });

    expect(form.fields.name.value()).toBe('Matt');
    expect(form.fields.age.value()).toBe(25);
    expect(form.valid()).toBe(true);
    expect(form.dirty()).toBe(false);
    expect(form.data()).toEqual({ name: 'Matt', age: 25 });
  });

  it('createForm fields have no-op methods', () => {
    const form = createForm({
      email: { initial: '', rules: [required(), email()] },
    });

    expect(form.fields.email.error()).toBeNull();
    expect(form.fields.email.errors()).toEqual([]);
    expect(form.fields.email.touched()).toBe(false);
    expect(form.fields.email.dirty()).toBe(false);
    expect(form.fields.email.valid()).toBe(true);

    // These should not throw
    form.fields.email.set('test@example.com');
    form.fields.email.touch();
    form.fields.email.reset();
    form.handleSubmit(() => {});
    form.reset();
  });

  it('components with createForm render without crashing during SSR', () => {
    const FormComponent = {
      setup() {
        const form = createForm({
          username: { initial: '', rules: [required(), minLength(3)] },
          email: { initial: '', rules: [email()] },
        });
        return { form };
      },
      render(ctx: Record<string, unknown>) {
        const el = createElement('form');
        const text = createTextNode('Form rendered');
        appendChild(el, text);
        return el;
      },
    };

    const { html } = renderToString(FormComponent);
    expect(html).toBe('<form>Form rendered</form>');
  });

  it('validation rule factories return no-op validators', () => {
    expect(required()('any')).toBeNull();
    expect(minLength(5)('ab')).toBeNull();
    expect(maxLength(5)('abcdefgh')).toBeNull();
    expect(min(10)(1)).toBeNull();
    expect(max(10)(100)).toBeNull();
    expect(email()('not-an-email')).toBeNull();
    expect(pattern(/^\d+$/)('abc')).toBeNull();
    expect(validate((v: number) => v > 0)(-1)).toBeNull();
  });
});

// =========================================================================
// SSR lifecycle capture stubs
// =========================================================================

describe('SSR lifecycle capture stubs', () => {
  it('pushDisposer is a callable no-op', () => {
    expect(() => pushDisposer(() => {})).not.toThrow();
  });

  it('startCapturingDisposers returns null', () => {
    expect(startCapturingDisposers()).toBeNull();
  });

  it('stopCapturingDisposers returns empty array', () => {
    expect(stopCapturingDisposers(null)).toEqual([]);
  });
});

// =========================================================================
// SSR head management
// =========================================================================

describe('SSR useHead', () => {
  it('collects head entries during renderToString', () => {
    const HeadComponent = {
      setup() {
        useHead({ title: 'My Page', meta: [{ name: 'description', content: 'A test page' }] });
        return {};
      },
      render() {
        const el = createElement('div');
        appendChild(el, createTextNode('Hello'));
        return el;
      },
    };

    const { html, head } = renderToString(HeadComponent);
    expect(html).toBe('<div>Hello</div>');
    expect(head).toHaveLength(1);
    expect(head[0].title).toBe('My Page');
    expect(head[0].meta![0].name).toBe('description');
  });

  it('serializeHead produces correct HTML tags', () => {
    const html = serializeHead([
      {
        title: 'Test',
        meta: [{ name: 'viewport', content: 'width=device-width' }],
        link: [{ rel: 'stylesheet', href: '/styles.css' }],
        script: [{ src: '/app.js' }],
      },
    ]);
    expect(html).toContain('<title>Test</title>');
    expect(html).toContain('<meta name="viewport" content="width=device-width">');
    expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(html).toContain('<script src="/app.js"></script>');
  });

  it('serializeHead includes nonce on script tags when provided', () => {
    const html = serializeHead([{ script: [{ src: '/app.js' }] }], 'abc123');
    expect(html).toContain('nonce="abc123"');
  });

  it('serializeHead escapes special characters', () => {
    const html = serializeHead([
      { title: '<script>alert("xss")</script>' },
      { meta: [{ name: 'test', content: '"quoted"' }] },
    ]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('component with useHead and createForm renders without errors', () => {
    const FullComponent = {
      setup() {
        useHead({ title: 'Form Page' });
        const form = createForm({ name: { initial: '' } });
        return { form };
      },
      render() {
        const el = createElement('form');
        appendChild(el, createTextNode('Form'));
        return el;
      },
    };

    const { html, head } = renderToString(FullComponent);
    expect(html).toBe('<form>Form</form>');
    expect(head[0].title).toBe('Form Page');
  });
});

// =========================================================================
// API routes
// =========================================================================

import { buildApiRoutes, handleApiRequest } from './api-handler.js';

describe('API routes', () => {
  it('buildApiRoutes creates route table from manifest', () => {
    const manifest = {
      '/src/routes/api/users/+server.ts': () => Promise.resolve({}),
      '/src/routes/api/users/[id]/+server.ts': () => Promise.resolve({}),
    };

    const routes = buildApiRoutes(manifest);
    expect(routes).toHaveLength(2);
    expect(routes.map((r) => r.path)).toContain('/api/users');
    expect(routes.map((r) => r.path)).toContain('/api/users/:id');
  });

  it('handleApiRequest dispatches to correct method handler', async () => {
    const manifest = {
      '/src/routes/api/hello/+server.ts': () =>
        Promise.resolve({
          GET: () =>
            new Response(JSON.stringify({ message: 'hello' }), {
              headers: { 'Content-Type': 'application/json' },
            }),
        }),
    };

    const routes = buildApiRoutes(manifest);
    const url = new URL('http://localhost/api/hello');
    const request = new Request(url.href);
    const response = await handleApiRequest(url, 'GET', request, routes);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    const body = await response!.json();
    expect(body.message).toBe('hello');
  });

  it('handleApiRequest returns 405 for unsupported methods', async () => {
    const manifest = {
      '/src/routes/api/data/+server.ts': () =>
        Promise.resolve({
          GET: () => new Response('ok'),
        }),
    };

    const routes = buildApiRoutes(manifest);
    const url = new URL('http://localhost/api/data');
    const request = new Request(url.href, { method: 'POST' });
    const response = await handleApiRequest(url, 'POST', request, routes);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(405);
    expect(response!.headers.get('Allow')).toBe('GET');
  });

  it('handleApiRequest returns null for unmatched routes', async () => {
    const routes = buildApiRoutes({});
    const url = new URL('http://localhost/api/nope');
    const request = new Request(url.href);
    const response = await handleApiRequest(url, 'GET', request, routes);
    expect(response).toBeNull();
  });

  it('handleApiRequest extracts params from dynamic routes', async () => {
    const manifest = {
      '/src/routes/api/users/[id]/+server.ts': () =>
        Promise.resolve({
          GET: (event: { params: Record<string, string> }) =>
            new Response(JSON.stringify(event.params)),
        }),
    };

    const routes = buildApiRoutes(manifest);
    const url = new URL('http://localhost/api/users/42');
    const request = new Request(url.href);
    const response = await handleApiRequest(url, 'GET', request, routes);

    expect(response).not.toBeNull();
    const body = await response!.json();
    expect(body.id).toBe('42');
  });
});

// =========================================================================
// SSR error boundaries
// =========================================================================

import { createErrorBoundary } from './ssr-runtime.js';

describe('SSR createErrorBoundary', () => {
  it('renders try function when it succeeds', () => {
    const node = createErrorBoundary(
      () => {
        const el = createElement('div');
        appendChild(el, createTextNode('OK'));
        return el;
      },
      () => createElement('div'),
    );
    expect(serializeVNode(node)).toBe('<div>OK</div>');
  });

  it('renders catch function when try throws', () => {
    const node = createErrorBoundary(
      () => {
        throw new Error('SSR fail');
      },
      (error) => {
        const el = createElement('p');
        appendChild(el, createTextNode(`Error: ${error.message}`));
        return el;
      },
    );
    expect(serializeVNode(node)).toBe('<p>Error: SSR fail</p>');
  });
});

// =========================================================================
// SSR lazy components
// =========================================================================

import { defineLazy } from './ssr-runtime.js';

describe('SSR defineLazy', () => {
  it('returns a component that renders the fallback', () => {
    const Lazy = defineLazy(
      () => Promise.resolve({ default: { render: () => createElement('div') } }),
      () => {
        const el = createElement('span');
        appendChild(el, createTextNode('Loading...'));
        return el;
      },
    );

    const node = createComponent(Lazy);
    expect(serializeVNode(node)).toBe('<span>Loading...</span>');
  });

  it('returns a comment node when no fallback is provided', () => {
    const Lazy = defineLazy(() =>
      Promise.resolve({ default: { render: () => createElement('div') } }),
    );

    const node = createComponent(Lazy);
    expect(serializeVNode(node)).toContain('<!--');
  });
});

// =========================================================================
// CSP nonce support
// =========================================================================

describe('CSP nonce support', () => {
  it('serializeHead does not include nonce when not provided', () => {
    const html = serializeHead([{ script: [{ src: '/app.js' }] }]);
    expect(html).not.toContain('nonce');
  });

  it('serializeHead adds nonce to script tags', () => {
    const html = serializeHead([{ script: [{ src: '/app.js' }] }], 'test-nonce-123');
    expect(html).toContain('nonce="test-nonce-123"');
  });

  it('rendered CSS includes nonce when handler option is set', () => {
    const StyledComponent = {
      render() {
        const el = createElement('div');
        appendChild(el, createTextNode('styled'));
        return el;
      },
      styles: '.foo { color: red; }',
    };

    const { css } = renderToString(StyledComponent);
    expect(css).toContain('.foo { color: red; }');
    // The nonce is injected by the handler layer, not renderToString itself
  });
});

// =========================================================================
// Security — Regression tests
// =========================================================================

describe('Security — serializeHead attribute filtering', () => {
  it('strips onload attribute from script tags', () => {
    const html = serializeHead([
      {
        script: [{ src: '/app.js', onload: 'alert(1)' } as any],
      },
    ]);
    expect(html).toContain('src="/app.js"');
    expect(html).not.toContain('onload');
  });

  it('strips onerror attribute from link tags', () => {
    const html = serializeHead([
      {
        link: [{ rel: 'stylesheet', href: '/style.css', onerror: 'alert(1)' } as any],
      },
    ]);
    expect(html).toContain('href="/style.css"');
    expect(html).not.toContain('onerror');
  });
});

describe('Security — VNode depth limit', () => {
  it('throws when VNode tree exceeds max depth', () => {
    // Build a deeply nested VNode tree (1002 levels)
    let node: VNode = { type: 2, text: 'leaf' } as VNode;
    for (let i = 0; i < 1002; i++) {
      node = { type: 1, tag: 'div', attrs: {}, children: [node] } as VNode;
    }
    expect(() => serializeVNode(node)).toThrow('maximum depth');
  });

  it('does not throw for trees within the limit', () => {
    let node: VNode = { type: 2, text: 'leaf' } as VNode;
    for (let i = 0; i < 100; i++) {
      node = { type: 1, tag: 'div', attrs: {}, children: [node] } as VNode;
    }
    expect(() => serializeVNode(node)).not.toThrow();
  });
});
