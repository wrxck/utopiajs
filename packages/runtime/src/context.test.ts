// ============================================================================
// context.test.ts — provide() / inject() owner threading
// ============================================================================
//
// provide/inject resolve against the owner that runSetupAndRender pushes
// around a component's setup AND render. The render half is what links a child
// created during the parent's render to that parent, so dropping the owner
// push leaves inject() silently returning its fallback with nothing else
// changing — no error, no missing DOM. These tests pin that contract.
// ============================================================================

import type { ComponentDefinition } from '@matthesketh/utopia-runtime';
import {
  appendChild,
  createComponent,
  createElement,
  createTextNode,
  inject,
  mount,
  provide,
  setText,
} from '@matthesketh/utopia-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = Symbol('theme');

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

/** A leaf that records whatever it injects, so the test can assert on it. */
const consumer = (seen: unknown[], fallback?: unknown): ComponentDefinition => ({
  setup() {
    seen.push(inject(KEY, fallback));
    return {};
  },
  render() {
    return createElement('span');
  },
});

describe('provide / inject', () => {
  it('resolves a value a parent provided to a child created during its render', () => {
    const seen: unknown[] = [];
    const Parent: ComponentDefinition = {
      setup() {
        provide(KEY, 'dark');
        return {};
      },
      render() {
        return createComponent(consumer(seen));
      },
    };

    const instance = mount(Parent, '#app');
    expect(seen).toEqual(['dark']);
    instance.unmount();
  });

  it('returns the fallback when no ancestor provided the key', () => {
    const seen: unknown[] = [];
    const instance = mount(consumer(seen, 'light'), '#app');
    expect(seen).toEqual(['light']);
    instance.unmount();
  });

  it('resolves the nearest ancestor when the key is provided twice', () => {
    const seen: unknown[] = [];
    const Middle: ComponentDefinition = {
      setup() {
        provide(KEY, 'inner');
        return {};
      },
      render() {
        return createComponent(consumer(seen));
      },
    };
    const Outer: ComponentDefinition = {
      setup() {
        provide(KEY, 'outer');
        return {};
      },
      render() {
        return createComponent(Middle);
      },
    };

    const instance = mount(Outer, '#app');
    expect(seen).toEqual(['inner']);
    instance.unmount();
  });

  it('does not leak a provided value to a later sibling tree', () => {
    const seen: unknown[] = [];
    const Provider: ComponentDefinition = {
      setup() {
        provide(KEY, 'scoped');
        return {};
      },
      render() {
        return createComponent(consumer(seen));
      },
    };

    createComponent(Provider);
    expect(seen).toEqual(['scoped']);

    // A component created afterwards is not a descendant, so the owner stack
    // must already have been unwound — otherwise the value leaks sideways.
    createComponent(consumer(seen, 'none'));
    expect(seen).toEqual(['scoped', 'none']);
  });

  it('unwinds the owner even when the parent render throws', () => {
    const seen: unknown[] = [];
    const Exploding: ComponentDefinition = {
      setup() {
        provide(KEY, 'doomed');
        return {};
      },
      render(): Node {
        throw new Error('render failed');
      },
    };

    expect(() => createComponent(Exploding)).toThrow('render failed');

    createComponent(consumer(seen, 'none'));
    expect(seen).toEqual(['none']);
  });

  it('warns instead of throwing when provide() is called with no owner', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    provide(KEY, 'stray');
    expect(warn).toHaveBeenCalledWith('[utopia] provide() called outside of component setup');
    warn.mockRestore();
  });

  it('threads a provided value through a text binding in the child', () => {
    const Parent: ComponentDefinition = {
      setup() {
        provide(KEY, 'themed');
        return {};
      },
      render() {
        const Child: ComponentDefinition = {
          setup() {
            return { label: inject<string>(KEY, 'plain') };
          },
          render(ctx: Record<string, unknown>) {
            const el = createElement('p');
            const text = createTextNode('');
            setText(text, ctx.label);
            appendChild(el, text);
            return el;
          },
        };
        return createComponent(Child);
      },
    };

    const instance = mount(Parent, '#app');
    expect(document.querySelector('#app p')!.textContent).toBe('themed');
    instance.unmount();
  });
});
