/**
 * Component-owned reactivity, lazy components and error boundaries.
 *
 * Each case here failed against the runtime before the fix: something the
 * component created kept running (or was created) after the component was
 * gone, or a value never reached the component it was meant for.
 */

import { computed, effect, signal, tick } from '@matthesketh/utopia-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ComponentDefinition } from '@/component';
import { createComponentInstance } from '@/component';
import { createComponent, createIf } from '@/directives';
import { createErrorBoundary } from '@/error-boundary';
import { createEffect } from '@/index';
import { defineLazy } from '@/lazy';

afterEach(() => {
  document.body.innerHTML = '';
});

const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('reactivity created in setup is owned by the component', () => {
  it('disposes a plain effect() from setup on unmount', () => {
    const source = signal(0);
    let runs = 0;
    const Comp: ComponentDefinition = {
      setup() {
        effect(() => {
          source();
          runs++;
        });
        return {};
      },
      render: () => document.createElement('div'),
    };

    const instance = createComponentInstance(Comp);
    instance.mount(document.body);
    instance.unmount();

    const before = runs;
    source.set(1);
    expect(runs).toBe(before);
  });

  it('disposes a computed() from setup on unmount', () => {
    const source = signal(1);
    const compute = vi.fn(() => source() * 2);
    let doubled!: () => number;
    const Comp: ComponentDefinition = {
      setup() {
        doubled = computed(compute);
        effect(() => void doubled());
        return {};
      },
      render: () => document.createElement('div'),
    };

    const instance = createComponentInstance(Comp);
    instance.mount(document.body);
    instance.unmount();

    const before = compute.mock.calls.length;
    source.set(2);
    doubled(); // frozen: a disposed computed does not recompute
    expect(compute.mock.calls.length).toBe(before);
  });

  it('disposes a child component’s setup effect when the parent unmounts', () => {
    const source = signal(0);
    let runs = 0;
    const Child: ComponentDefinition = {
      setup() {
        effect(() => {
          source();
          runs++;
        });
        return {};
      },
      render: () => document.createElement('span'),
    };
    const Parent: ComponentDefinition = {
      render() {
        const div = document.createElement('div');
        div.appendChild(createComponent(Child));
        return div;
      },
    };

    const instance = createComponentInstance(Parent);
    instance.mount(document.body);
    instance.unmount();

    const before = runs;
    source.set(1);
    expect(runs).toBe(before);
  });

  it('disposes what a failed render created before it threw', () => {
    const source = signal(0);
    let runs = 0;
    const Broken: ComponentDefinition = {
      setup() {
        effect(() => {
          source();
          runs++;
        });
        return {};
      },
      render() {
        createEffect(() => {
          source();
          runs++;
        });
        throw new Error('render failed');
      },
    };

    const instance = createComponentInstance(Broken);
    expect(() => instance.mount(document.body)).toThrow('render failed');

    const before = runs;
    source.set(1);
    expect(runs).toBe(before);
  });
});

describe('defineLazy', () => {
  it('passes its props and slots to the component it loads', async () => {
    const Inner: ComponentDefinition = {
      setup: (props) => ({ label: props.label }),
      render(ctx) {
        const span = document.createElement('span');
        const slot = (ctx.$slots as Record<string, () => Node>).default;
        span.textContent = String(ctx.label);
        if (slot) span.appendChild(slot());
        return span;
      },
    };
    const Lazy = defineLazy(() => Promise.resolve({ default: Inner }));
    const host = document.createElement('div');
    document.body.appendChild(host);

    host.appendChild(
      createComponent(Lazy, { label: 'hi' }, { default: () => document.createTextNode('!') }),
    );
    await flushMicrotasks();
    expect(host.textContent).toBe('hi!');

    // a second instance takes the cached path, which must pass them too.
    const again = document.createElement('div');
    again.appendChild(createComponent(Lazy, { label: 'again' }));
    expect(again.textContent).toBe('again');
  });

  it('does not mount the component when its scope was disposed before the load finished', async () => {
    let setups = 0;
    const Inner: ComponentDefinition = {
      setup() {
        setups++;
        return {};
      },
      render: () => document.createElement('span'),
    };
    let resolve!: (mod: { default: ComponentDefinition }) => void;
    const Lazy = defineLazy(() => new Promise((r) => (resolve = r)));
    const Parent: ComponentDefinition = {
      render() {
        const div = document.createElement('div');
        div.appendChild(createComponent(Lazy));
        return div;
      },
    };

    const instance = createComponentInstance(Parent);
    instance.mount(document.body);
    instance.unmount();

    resolve({ default: Inner });
    await flushMicrotasks();
    expect(setups).toBe(0);
  });
});

describe('createErrorBoundary', () => {
  it('disposes its effects with the branch that contains it', async () => {
    const show = signal(true);
    const source = signal(0);
    let runs = 0;

    const parent = document.createElement('div');
    const anchor = document.createComment('u-if');
    parent.appendChild(anchor);
    document.body.appendChild(parent);

    createIf(
      anchor,
      () => show(),
      () => {
        // the boundary is nested inside the branch root, so the branch's
        // node-level cleanup hook never reaches it.
        const wrapper = document.createElement('section');
        wrapper.appendChild(
          createErrorBoundary(
            () => {
              const text = document.createTextNode('');
              createEffect(() => {
                source();
                runs++;
              });
              return text;
            },
            () => document.createTextNode('failed'),
          ),
        );
        return wrapper;
      },
    );

    show.set(false);
    const before = runs;
    source.set(1);
    await tick();
    expect(runs).toBe(before);
  });
});
