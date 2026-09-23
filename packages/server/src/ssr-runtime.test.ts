// ============================================================================
// @matthesketh/utopia-server — SSR runtime tests (stubs, instances, edge cases)
// ============================================================================

import { describe, expect, it, vi } from 'vitest';

import { serializeVNode } from './render-to-string';
import {
  appendChild,
  applyModel,
  createComment,
  createComponent,
  createComponentInstance,
  createElement,
  createErrorBoundary,
  createFor,
  createIf,
  createTextNode,
  createTransition,
  effect,
  flushStyles,
  inject,
  insertBefore,
  mergeClass,
  mount,
  nextTick,
  onDestroy,
  onMount,
  provide,
  queueJob,
  removeNode,
  setAttr,
  setHtml,
  setSafeHtml,
  setServerHtmlSanitizer,
  useEventListener,
  useInterval,
  useTimeout,
} from './ssr-runtime';
import type { VComment, VElement } from './vnode';

describe('setAttr — edge cases', () => {
  it('removes class when value is null or false', () => {
    const el = createElement('div');
    setAttr(el, 'class', 'a');
    setAttr(el, 'class', null);
    expect(el.attrs.class).toBeUndefined();
    setAttr(el, 'class', 'a');
    setAttr(el, 'class', false);
    expect(el.attrs.class).toBeUndefined();
  });

  it('ignores class values of unsupported types', () => {
    const el = createElement('div');
    setAttr(el, 'class', 42);
    expect(el.attrs.class).toBeUndefined();
  });

  it('removes style when value is null or false', () => {
    const el = createElement('div');
    setAttr(el, 'style', 'color: red');
    setAttr(el, 'style', null);
    expect(el.attrs.style).toBeUndefined();
    setAttr(el, 'style', 'color: red');
    setAttr(el, 'style', false);
    expect(el.attrs.style).toBeUndefined();
  });

  it('ignores style values of unsupported types', () => {
    const el = createElement('div');
    setAttr(el, 'style', 42);
    expect(el.attrs.style).toBeUndefined();
  });

  it('skips null-valued properties in style objects', () => {
    const el = createElement('div');
    setAttr(el, 'style', { color: 'red', backgroundColor: null, marginTop: '4px' });
    expect(el.attrs.style).toBe('color: red; margin-top: 4px');
  });

  it('removes a previously set generic attribute when value becomes null', () => {
    const el = createElement('div');
    setAttr(el, 'data-x', 'y');
    setAttr(el, 'data-x', null);
    expect(el.attrs['data-x']).toBeUndefined();
    setAttr(el, 'data-x', 'y');
    setAttr(el, 'data-x', false);
    expect(el.attrs['data-x']).toBeUndefined();
  });

  it('blocks unsafe data: URLs on navigation attributes', () => {
    const a = createElement('a');
    setAttr(a, 'href', 'data:text/html,<script>alert(1)</script>');
    expect(a.attrs.href).toBeUndefined();
  });

  it('blocks non-media data: URLs even on media attributes', () => {
    const img = createElement('img');
    setAttr(img, 'src', 'data:text/html,<script>alert(1)</script>');
    expect(img.attrs.src).toBeUndefined();
  });

  it('blocks vbscript: URLs case-insensitively with leading whitespace', () => {
    const a = createElement('a');
    setAttr(a, 'href', '  VBScript:MsgBox(1)');
    expect(a.attrs.href).toBeUndefined();
  });

  it('drops mixed-case event handler attributes', () => {
    const el = createElement('div');
    setAttr(el, 'onClick', 'alert(1)');
    expect(el.attrs.onClick).toBeUndefined();
  });
});

describe('createIf / createFor — detached anchors', () => {
  it('returned stop functions are callable no-ops for attached anchors too', () => {
    const parent = createElement('div');
    const ifAnchor = createComment('if');
    appendChild(parent, ifAnchor);
    const stopIf = createIf(
      ifAnchor as VComment,
      () => true,
      () => createElement('span'),
    );
    stopIf();

    const forAnchor = createComment('for');
    appendChild(parent, forAnchor);
    const stopFor = createFor(
      forAnchor as VComment,
      () => [1],
      () => createElement('li'),
    );
    stopFor();

    // effect's returned disposer is likewise a callable no-op.
    const disposeEffect = effect(() => () => {});
    disposeEffect();
  });

  it('createIf is a no-op when the anchor has no parent', () => {
    const anchor = createComment('if') as VComment;
    const stop = createIf(
      anchor,
      () => true,
      () => createElement('div'),
    );
    expect(typeof stop).toBe('function');
    stop();
  });

  it('createFor is a no-op when the anchor has no parent', () => {
    const anchor = createComment('for') as VComment;
    const stop = createFor(
      anchor,
      () => [1, 2],
      () => createElement('li'),
    );
    expect(typeof stop).toBe('function');
    stop();
  });
});

describe('removeNode — inconsistent parent link', () => {
  it('clears _parent even when the node is not among the children', () => {
    const parent = createElement('div');
    const stray = createTextNode('stray');
    stray._parent = parent; // parent link without membership
    removeNode(stray);
    expect(stray._parent).toBeUndefined();
    expect(parent.children).toHaveLength(0);
  });
});

describe('insertBefore — missing anchor', () => {
  it('appends when the anchor is not among the children', () => {
    const parent = createElement('div');
    const existing = createTextNode('a');
    appendChild(parent, existing);
    const orphanAnchor = createTextNode('anchor');
    const node = createTextNode('b');
    insertBefore(parent, node, orphanAnchor);
    expect(parent.children[parent.children.length - 1]).toBe(node);
  });
});

describe('createComponentInstance / mount', () => {
  const Component = {
    setup: (props: Record<string, unknown>) => ({ label: props.label ?? 'default' }),
    render: (ctx: Record<string, unknown>) => {
      const el = createElement('button');
      appendChild(el, createTextNode(String(ctx.label)));
      return el;
    },
    styles: '.btn { color: blue; }',
  };

  it('mounts and unmounts an instance, collecting styles', () => {
    flushStyles();
    const instance = createComponentInstance(Component, { label: 'Go' });
    expect(instance.el).toBeNull();
    instance.mount(null);
    expect(serializeVNode(instance.el as VElement)).toBe('<button>Go</button>');
    expect(flushStyles()).toEqual(['.btn { color: blue; }']);
    instance.unmount();
    expect(instance.el).toBeNull();
  });

  it('renders slots provided on the instance', () => {
    const Slotted = {
      render: (ctx: Record<string, unknown>) => {
        const wrapper = createElement('div');
        const slots = ctx.$slots as Record<string, () => VElement>;
        if (slots.default) appendChild(wrapper, slots.default());
        return wrapper;
      },
    };
    const instance = createComponentInstance(Slotted);
    instance.slots.default = () => {
      const s = createElement('span');
      appendChild(s, createTextNode('slotted'));
      return s;
    };
    instance.mount(null);
    expect(serializeVNode(instance.el as VElement)).toBe('<div><span>slotted</span></div>');
  });

  it('mount() helper creates and mounts an instance without setup', () => {
    const Bare = { render: () => createElement('hr') };
    const instance = mount(Bare, null);
    expect(serializeVNode(instance.el as VElement)).toBe('<hr>');
  });
});

describe('lifecycle and scheduler stubs', () => {
  it('onMount and onDestroy never invoke their callbacks on the server', () => {
    const fn = vi.fn();
    onMount(fn);
    onDestroy(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('useEventListener / useInterval / useTimeout return callable stop functions', () => {
    const cb = vi.fn();
    for (const stop of [
      useEventListener(null, 'click', cb),
      useInterval(cb, 100),
      useTimeout(cb, 100),
    ]) {
      expect(typeof stop).toBe('function');
      stop();
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it('createTransition is a no-op and queueJob runs its job inline', () => {
    const fn = vi.fn();
    createTransition(createElement('div'), {});
    // The DOM bindings route through the scheduler, so an SSR queueJob that
    // dropped the job would silently skip every scheduled binding. It runs
    // the job immediately instead — there is no event loop to defer to.
    queueJob(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('nextTick resolves', async () => {
    await expect(nextTick()).resolves.toBeUndefined();
  });
});

describe('createErrorBoundary — non-Error throws', () => {
  it('wraps thrown non-Error values in an Error', () => {
    const node = createErrorBoundary(
      () => {
        throw 'plain string failure';
      },
      (error) => {
        expect(error).toBeInstanceOf(Error);
        const el = createElement('div');
        appendChild(el, createTextNode(error.message));
        return el;
      },
    );
    expect(serializeVNode(node)).toBe('<div>plain string failure</div>');
  });
});

// ---------------------------------------------------------------------------
// parity with the client runtime's attribute handling
// ---------------------------------------------------------------------------

describe('setAttr — class and style values the client accepts', () => {
  it('renders class arrays and nested arrays like the client', () => {
    const el = createElement('div');
    setAttr(el, 'class', ['a', { b: true, c: false }, ['d']]);
    expect(el.attrs.class).toBe('a b d');
  });

  it('merges a static class with a bound one', () => {
    expect(mergeClass('btn', ['primary', { active: true }])).toBe('btn primary active');
    expect(mergeClass('btn', '')).toBe('btn');
  });

  it('renders style arrays with later entries winning', () => {
    const el = createElement('div');
    setAttr(el, 'style', ['color: red; margin: 0', { color: 'blue', fontSize: '2px' }]);
    expect(el.attrs.style).toBe('color: blue; margin: 0; font-size: 2px');
  });
});

describe('setAttr — url and aria guards match the client', () => {
  it.each(['java\tscript:alert(1)', '\u0001javascript:alert(1)', 'java\nscript:x'])(
    'drops %j on href',
    (value) => {
      const el = createElement('a');
      setAttr(el, 'href', value);
      expect(el.attrs.href).toBeUndefined();
    },
  );

  it('writes aria booleans as "true"/"false"', () => {
    const el = createElement('button');
    setAttr(el, 'aria-expanded', false);
    expect(el.attrs['aria-expanded']).toBe('false');
    setAttr(el, 'aria-expanded', true);
    expect(el.attrs['aria-expanded']).toBe('true');
  });
});

describe('u-html on the server', () => {
  it('writes trusted html verbatim for u-html.raw', () => {
    const el = createElement('div');
    setHtml(el, () => '<b>x</b>');
    expect(serializeVNode(el)).toBe('<div><b>x</b></div>');
  });

  it('leaves sanitised u-html empty when no server sanitiser is installed', () => {
    const el = createElement('div');
    setSafeHtml(el, () => '<img src=x onerror=alert(1)>');
    expect(serializeVNode(el)).toBe('<div></div>');
  });

  it('uses an installed server sanitiser', () => {
    setServerHtmlSanitizer((html) => html.replace(/<img[^>]*>/g, ''));
    try {
      const el = createElement('div');
      setSafeHtml(el, () => '<p>ok</p><img src=x onerror=alert(1)>');
      expect(serializeVNode(el)).toBe('<div><p>ok</p></div>');
    } finally {
      setServerHtmlSanitizer(null);
    }
  });
});

describe('u-model initial state on the server', () => {
  it('renders value, checked, textarea text and the selected option', () => {
    const text = createElement('input');
    applyModel(text, () => 'hello');
    expect(serializeVNode(text)).toBe('<input value="hello">');

    const box = createElement('input');
    box.attrs.type = 'checkbox';
    applyModel(box, () => true);
    expect(serializeVNode(box)).toBe('<input type="checkbox" checked>');

    const radio = createElement('input');
    radio.attrs.type = 'radio';
    radio.attrs.value = 'b';
    applyModel(radio, () => 'b');
    expect(serializeVNode(radio)).toBe('<input type="radio" value="b" checked>');

    const area = createElement('textarea');
    applyModel(area, () => 'a < b');
    expect(serializeVNode(area)).toBe('<textarea>a &lt; b</textarea>');

    const select = createElement('select');
    applyModel(select, () => 'two');
    for (const v of ['one', 'two']) {
      const opt = createElement('option');
      opt.attrs.value = v;
      appendChild(select, opt);
    }
    expect(serializeVNode(select)).toBe(
      '<select><option value="one"></option><option value="two" selected></option></select>',
    );
  });
});

describe('structural directives whose anchor has no parent yet', () => {
  it('renders an else-if branch returned into an outer u-if', () => {
    // the compiled shape of <b u-if="false"> / <i u-else-if="true">
    const root = createElement('div');
    const outer = createComment('u-if');
    appendChild(root, outer);
    createIf(
      outer,
      () => false,
      () => createElement('b'),
      () => {
        const inner = createComment('u-if');
        createIf(
          inner,
          () => true,
          () => createElement('i'),
        );
        return inner;
      },
    );
    expect(serializeVNode(root)).toBe('<div><!--[--><!--[--><i></i><!--u-if--><!--u-if--></div>');
  });

  it('renders a component whose root is a u-if or u-for', () => {
    const IfRoot = {
      render() {
        const anchor = createComment('u-if');
        createIf(
          anchor,
          () => true,
          () => createElement('p'),
        );
        return anchor;
      },
    };
    const ForRoot = {
      render() {
        const anchor = createComment('u-for');
        createFor(
          anchor,
          () => [1, 2],
          () => createElement('li'),
        );
        return anchor;
      },
    };
    expect(serializeVNode(createComponent(IfRoot))).toBe('<!--[--><p></p><!--u-if-->');
    expect(serializeVNode(createComponent(ForRoot))).toBe('<!--[--><li></li><li></li><!--u-for-->');
  });
});

describe('provide / inject on the server', () => {
  it('resolves a value provided by an ancestor', () => {
    const KEY = Symbol('theme');
    const Child = {
      setup: () => ({ theme: inject(KEY, 'light') }),
      render(ctx: Record<string, unknown>) {
        const el = createElement('span');
        appendChild(el, createTextNode(String(ctx.theme)));
        return el;
      },
    };
    const Parent = {
      setup() {
        provide(KEY, 'dark');
        return {};
      },
      render() {
        const el = createElement('div');
        appendChild(el, createComponent(Child));
        return el;
      },
    };
    expect(serializeVNode(createComponent(Parent))).toBe('<div><span>dark</span></div>');
    expect(serializeVNode(createComponent(Child))).toBe('<span>light</span>');
  });
});
