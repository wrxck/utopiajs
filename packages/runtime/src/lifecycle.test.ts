import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal } from '@matthesketh/utopia-core';
import {
  mount,
  onMount,
  onDestroy,
  createComponent,
  createElement,
  createTextNode,
  appendChild,
} from '@matthesketh/utopia-runtime';
import type { ComponentDefinition } from '@matthesketh/utopia-runtime';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe('onMount', () => {
  it('fires after the component is mounted', () => {
    const calls: string[] = [];

    const App: ComponentDefinition = {
      setup() {
        onMount(() => calls.push('mounted'));
        return {};
      },
      render() {
        return createElement('div');
      },
    };

    expect(calls).toEqual([]);
    const instance = mount(App, '#app');
    expect(calls).toEqual(['mounted']);
    instance.unmount();
  });

  it('fires multiple callbacks in registration order', () => {
    const calls: string[] = [];

    const App: ComponentDefinition = {
      setup() {
        onMount(() => calls.push('first'));
        onMount(() => calls.push('second'));
        onMount(() => calls.push('third'));
        return {};
      },
      render() {
        return createElement('div');
      },
    };

    mount(App, '#app');
    expect(calls).toEqual(['first', 'second', 'third']);
  });

  it('fires for child components via createComponent', () => {
    const calls: string[] = [];

    const Child: ComponentDefinition = {
      setup() {
        onMount(() => calls.push('child-mounted'));
        return {};
      },
      render() {
        return createElement('span');
      },
    };

    const App: ComponentDefinition = {
      render() {
        const root = createElement('div');
        const child = createComponent(Child, {});
        appendChild(root, child);
        return root;
      },
    };

    mount(App, '#app');
    expect(calls).toEqual(['child-mounted']);
  });
});

describe('onDestroy', () => {
  it('fires when the component is unmounted', () => {
    const calls: string[] = [];

    const App: ComponentDefinition = {
      setup() {
        onDestroy(() => calls.push('destroyed'));
        return {};
      },
      render() {
        return createElement('div');
      },
    };

    const instance = mount(App, '#app');
    expect(calls).toEqual([]);
    instance.unmount();
    expect(calls).toEqual(['destroyed']);
  });

  it('fires multiple callbacks in registration order', () => {
    const calls: string[] = [];

    const App: ComponentDefinition = {
      setup() {
        onDestroy(() => calls.push('first'));
        onDestroy(() => calls.push('second'));
        onDestroy(() => calls.push('third'));
        return {};
      },
      render() {
        return createElement('div');
      },
    };

    const instance = mount(App, '#app');
    expect(calls).toEqual([]);
    instance.unmount();
    expect(calls).toEqual(['first', 'second', 'third']);
  });

  it('fires for child components when their node is cleaned up', () => {
    const calls: string[] = [];

    const Child: ComponentDefinition = {
      setup() {
        onDestroy(() => calls.push('child-destroyed'));
        return {};
      },
      render() {
        return createElement('span');
      },
    };

    // Simulate what the runtime does: createComponent returns a node with __cleanup
    const node = createComponent(Child, {});
    expect(calls).toEqual([]);

    // Trigger cleanup (as clearNodes would do internally)
    if ((node as any).__cleanup) {
      (node as any).__cleanup();
    }
    expect(calls).toEqual(['child-destroyed']);
  });
});

describe('lifecycle warnings', () => {
  it('warns when onMount is called outside setup', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onMount(() => {});
    expect(warnSpy).toHaveBeenCalledWith('[utopia] onMount() called outside of component setup');
    warnSpy.mockRestore();
  });

  it('warns when onDestroy is called outside setup', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onDestroy(() => {});
    expect(warnSpy).toHaveBeenCalledWith('[utopia] onDestroy() called outside of component setup');
    warnSpy.mockRestore();
  });
});
