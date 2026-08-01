// ============================================================================
// @matthesketh/utopia-server — SSR runtime tests (stubs, instances, edge cases)
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  createElement,
  createTextNode,
  createComment,
  setAttr,
  appendChild,
  insertBefore,
  removeNode,
  createIf,
  createFor,
  effect,
  createComponentInstance,
  mount,
  onMount,
  onDestroy,
  useEventListener,
  useInterval,
  useTimeout,
  createTransition,
  queueJob,
  nextTick,
  createErrorBoundary,
  flushStyles,
} from './ssr-runtime';
import type { VComment, VElement } from './vnode';
import { serializeVNode } from './render-to-string';

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
