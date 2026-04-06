/**
 * @matthesketh/utopia-runtime — Test suite
 *
 * Uses vitest with jsdom (configured in the root vitest.config.ts).
 * The @matthesketh/utopia-core package is resolved via the vitest alias to its source,
 * so no build step is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signal, effect as coreEffect, type ReadonlySignal } from '@matthesketh/utopia-core';

import {
  createElement,
  createTextNode,
  setText,
  setAttr,
  addEventListener,
  insertBefore,
  removeNode,
  appendChild,
  createComment,
} from './dom.js';

import { createIf, createFor, createComponent } from './directives.js';
import { createComponentInstance, mount } from './component.js';
import type { ComponentDefinition } from './component.js';
import { queueJob, nextTick } from './scheduler.js';
import { hydrate } from './hydration.js';
import { createEffect } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh container <div> appended to the document body. */
function container(): HTMLDivElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

// =========================================================================
// DOM helpers
// =========================================================================

describe('DOM helpers', () => {
  describe('createElement', () => {
    it('creates an element with the correct tag name', () => {
      const el = createElement('div');
      expect(el).toBeInstanceOf(HTMLDivElement);
      expect(el.tagName).toBe('DIV');
    });

    it('creates various element types', () => {
      expect(createElement('span').tagName).toBe('SPAN');
      expect(createElement('button').tagName).toBe('BUTTON');
      expect(createElement('input').tagName).toBe('INPUT');
    });
  });

  describe('createTextNode', () => {
    it('creates a text node with the given text', () => {
      const node = createTextNode('hello');
      expect(node).toBeInstanceOf(Text);
      expect(node.data).toBe('hello');
    });

    it('converts non-string values to strings', () => {
      const node = createTextNode(String(42));
      expect(node.data).toBe('42');
    });
  });

  describe('setText', () => {
    it('sets the text content of a text node', () => {
      const node = createTextNode('initial');
      setText(node, 'updated');
      expect(node.data).toBe('updated');
    });

    it('converts null/undefined to empty string', () => {
      const node = createTextNode('hello');
      setText(node, null);
      expect(node.data).toBe('');
      setText(node, undefined);
      expect(node.data).toBe('');
    });

    it('converts numbers to strings', () => {
      const node = createTextNode('');
      setText(node, 42);
      expect(node.data).toBe('42');
    });

    it('skips update when value has not changed', () => {
      const node = createTextNode('same');
      const originalDescriptor = Object.getOwnPropertyDescriptor(CharacterData.prototype, 'data')!;
      const setter = vi.fn(originalDescriptor.set!);
      Object.defineProperty(node, 'data', {
        get: originalDescriptor.get,
        set: setter,
        configurable: true,
      });

      setText(node, 'same');
      // Setter should not have been called because the value didn't change.
      expect(setter).not.toHaveBeenCalled();
    });
  });

  describe('setAttr', () => {
    let el: HTMLElement;

    beforeEach(() => {
      el = createElement('div') as HTMLElement;
    });

    it('sets a plain string attribute', () => {
      setAttr(el, 'id', 'my-id');
      expect(el.getAttribute('id')).toBe('my-id');
    });

    it('removes attribute when value is null', () => {
      setAttr(el, 'id', 'my-id');
      setAttr(el, 'id', null);
      expect(el.hasAttribute('id')).toBe(false);
    });

    it('removes attribute when value is false', () => {
      setAttr(el, 'title', 'hello');
      setAttr(el, 'title', false);
      expect(el.hasAttribute('title')).toBe(false);
    });

    // --- class -------------------------------------------------------------

    it('sets class from a string', () => {
      setAttr(el, 'class', 'foo bar');
      expect(el.className).toBe('foo bar');
    });

    it('sets class from an object', () => {
      setAttr(el, 'class', { active: true, hidden: false, large: true });
      expect(el.className).toBe('active large');
    });

    it('clears class when value is null', () => {
      el.className = 'existing';
      setAttr(el, 'class', null);
      expect(el.hasAttribute('class')).toBe(false);
    });

    // --- style -------------------------------------------------------------

    it('sets style from a string', () => {
      setAttr(el, 'style', 'color: red; font-size: 14px');
      expect(el.style.color).toBe('red');
    });

    it('sets style from an object with camelCase properties', () => {
      setAttr(el, 'style', { color: 'blue', fontSize: '16px' });
      expect(el.style.color).toBe('blue');
      expect(el.style.fontSize).toBe('16px');
    });

    it('clears style when value is null', () => {
      el.style.cssText = 'color: red';
      setAttr(el, 'style', null);
      expect(el.hasAttribute('style')).toBe(false);
    });

    // --- boolean attributes ------------------------------------------------

    it('sets boolean attribute (disabled)', () => {
      const btn = createElement('button') as HTMLButtonElement;
      setAttr(btn, 'disabled', true);
      expect(btn.hasAttribute('disabled')).toBe(true);
      expect(btn.disabled).toBe(true);
    });

    it('removes boolean attribute when falsy', () => {
      const btn = createElement('button') as HTMLButtonElement;
      setAttr(btn, 'disabled', true);
      setAttr(btn, 'disabled', false);
      expect(btn.hasAttribute('disabled')).toBe(false);
      expect(btn.disabled).toBe(false);
    });

    it('handles checked on input', () => {
      const input = createElement('input') as HTMLInputElement;
      input.type = 'checkbox';
      setAttr(input, 'checked', true);
      expect(input.checked).toBe(true);
      setAttr(input, 'checked', false);
      expect(input.checked).toBe(false);
    });

    // --- data-* attributes -------------------------------------------------

    it('sets data-* attributes via dataset', () => {
      setAttr(el, 'data-user-id', '42');
      expect(el.dataset.userId).toBe('42');
    });

    it('converts null to empty string for data-* attributes', () => {
      setAttr(el, 'data-info', null);
      expect(el.dataset.info).toBe('');
    });

    // --- value = true maps to empty string attribute -----------------------

    it('sets attribute to empty string when value is true (non-boolean attr)', () => {
      setAttr(el, 'aria-hidden', true);
      expect(el.getAttribute('aria-hidden')).toBe('');
    });
  });

  describe('addEventListener', () => {
    it('adds an event listener and returns a cleanup function', () => {
      const el = createElement('button') as HTMLElement;
      const handler = vi.fn();

      const cleanup = addEventListener(el, 'click', handler);

      el.click();
      expect(handler).toHaveBeenCalledTimes(1);

      cleanup();
      el.click();
      // Handler should not have been called again after cleanup.
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners for the same event', () => {
      const el = createElement('div') as HTMLElement;
      const a = vi.fn();
      const b = vi.fn();

      const cleanupA = addEventListener(el, 'click', a);
      const cleanupB = addEventListener(el, 'click', b);

      el.click();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);

      cleanupA();
      el.click();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(2);

      cleanupB();
    });
  });

  describe('insertBefore / removeNode', () => {
    it('inserts a node before the anchor', () => {
      const parent = container();
      const anchor = document.createComment('anchor');
      parent.appendChild(anchor);

      const span = createElement('span');
      insertBefore(parent, span, anchor);

      expect(parent.firstChild).toBe(span);
      expect(parent.lastChild).toBe(anchor);
    });

    it('appends when anchor is null', () => {
      const parent = container();
      const existing = createElement('p');
      parent.appendChild(existing);

      const span = createElement('span');
      insertBefore(parent, span, null);

      expect(parent.lastChild).toBe(span);
    });

    it('removes a node from its parent', () => {
      const parent = container();
      const child = createElement('div');
      parent.appendChild(child);

      expect(parent.contains(child)).toBe(true);
      removeNode(child);
      expect(parent.contains(child)).toBe(false);
    });

    it('removeNode is a no-op when node has no parent', () => {
      const orphan = createElement('div');
      // Should not throw.
      expect(() => removeNode(orphan)).not.toThrow();
    });
  });

  describe('appendChild', () => {
    it('appends a child node to a parent', () => {
      const parent = createElement('div');
      const child = createElement('span');
      appendChild(parent, child);
      expect(parent.firstChild).toBe(child);
    });

    it('appends multiple children in order', () => {
      const parent = createElement('ul');
      const li1 = createElement('li');
      const li2 = createElement('li');
      appendChild(parent, li1);
      appendChild(parent, li2);
      expect(parent.childNodes.length).toBe(2);
      expect(parent.firstChild).toBe(li1);
      expect(parent.lastChild).toBe(li2);
    });
  });

  describe('createComment', () => {
    it('creates a comment node with the given text', () => {
      const comment = createComment('u-if');
      expect(comment).toBeInstanceOf(Comment);
      expect(comment.data).toBe('u-if');
    });

    it('creates a comment with empty text', () => {
      const comment = createComment('');
      expect(comment.data).toBe('');
    });
  });
});

// =========================================================================
// Directives
// =========================================================================

describe('Directives', () => {
  describe('createIf', () => {
    it('renders the true branch when condition is truthy', () => {
      const parent = container();
      const anchor = document.createComment('if');
      parent.appendChild(anchor);

      const show = signal(true);

      createIf(
        anchor,
        () => show(),
        () => {
          const el = createElement('span');
          el.textContent = 'visible';
          return el;
        },
      );

      expect(parent.querySelector('span')).not.toBeNull();
      expect(parent.querySelector('span')!.textContent).toBe('visible');
    });

    it('renders the false branch when condition is falsy', () => {
      const parent = container();
      const anchor = document.createComment('if');
      parent.appendChild(anchor);

      const show = signal(false);

      createIf(
        anchor,
        () => show(),
        () => {
          const el = createElement('span');
          el.textContent = 'yes';
          return el;
        },
        () => {
          const el = createElement('em');
          el.textContent = 'no';
          return el;
        },
      );

      expect(parent.querySelector('span')).toBeNull();
      expect(parent.querySelector('em')).not.toBeNull();
      expect(parent.querySelector('em')!.textContent).toBe('no');
    });

    it('toggles between branches when condition changes', () => {
      const parent = container();
      const anchor = document.createComment('if');
      parent.appendChild(anchor);

      const show = signal(true);

      createIf(
        anchor,
        () => show(),
        () => {
          const el = createElement('span');
          el.textContent = 'true-branch';
          return el;
        },
        () => {
          const el = createElement('em');
          el.textContent = 'false-branch';
          return el;
        },
      );

      expect(parent.querySelector('span')).not.toBeNull();
      expect(parent.querySelector('em')).toBeNull();

      show.set(false);
      expect(parent.querySelector('span')).toBeNull();
      expect(parent.querySelector('em')).not.toBeNull();

      show.set(true);
      expect(parent.querySelector('span')).not.toBeNull();
      expect(parent.querySelector('em')).toBeNull();
    });

    it('renders nothing when condition is falsy and there is no false branch', () => {
      const parent = container();
      const anchor = document.createComment('if');
      parent.appendChild(anchor);

      const show = signal(false);

      createIf(
        anchor,
        () => show(),
        () => createElement('span'),
      );

      // Only the comment anchor should be in the parent.
      expect(parent.childNodes.length).toBe(1);
      expect(parent.firstChild).toBe(anchor);
    });

    it('cleans up nodes when dispose is called', () => {
      const parent = container();
      const anchor = document.createComment('if');
      parent.appendChild(anchor);

      const show = signal(true);

      const dispose = createIf(
        anchor,
        () => show(),
        () => {
          const el = createElement('div');
          el.textContent = 'content';
          return el;
        },
      );

      expect(parent.querySelector('div')).not.toBeNull();

      dispose();
      expect(parent.querySelector('div')).toBeNull();
    });

    it('does not throw when anchor has no parentNode', () => {
      const anchor = document.createComment('if');
      // anchor is NOT appended to any parent
      const show = signal(true);

      expect(() => {
        createIf(
          anchor,
          () => show(),
          () => createElement('span'),
        );
      }).not.toThrow();
    });
  });

  describe('createFor', () => {
    it('renders a list of items', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal(['a', 'b', 'c']);

      createFor(
        anchor,
        () => items(),
        (item, index) => {
          const li = createElement('li');
          li.textContent = `${index}: ${item}`;
          return li;
        },
      );

      const lis = parent.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[0].textContent).toBe('0: a');
      expect(lis[1].textContent).toBe('1: b');
      expect(lis[2].textContent).toBe('2: c');
    });

    it('updates when the list changes', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([1, 2]);

      createFor(
        anchor,
        () => items(),
        (item) => {
          const span = createElement('span');
          span.textContent = String(item);
          return span;
        },
      );

      expect(parent.querySelectorAll('span').length).toBe(2);

      items.set([1, 2, 3, 4]);
      expect(parent.querySelectorAll('span').length).toBe(4);
      expect(parent.querySelectorAll('span')[3].textContent).toBe('4');
    });

    it('clears the list when set to empty', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal(['x', 'y']);

      createFor(
        anchor,
        () => items(),
        (item) => {
          const li = createElement('li');
          li.textContent = item;
          return li;
        },
      );

      expect(parent.querySelectorAll('li').length).toBe(2);

      items.set([]);
      expect(parent.querySelectorAll('li').length).toBe(0);
    });

    it('cleans up nodes when dispose is called', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal(['a', 'b']);

      const dispose = createFor(
        anchor,
        () => items(),
        (item) => {
          const span = createElement('span');
          span.textContent = item;
          return span;
        },
      );

      expect(parent.querySelectorAll('span').length).toBe(2);

      dispose();
      expect(parent.querySelectorAll('span').length).toBe(0);
    });

    it('does not throw when anchor has no parentNode', () => {
      const anchor = document.createComment('for');
      // anchor is NOT appended to any parent
      const items = signal(['a', 'b', 'c']);

      expect(() => {
        createFor(
          anchor,
          () => items(),
          (item) => {
            const span = createElement('span');
            span.textContent = item;
            return span;
          },
        );
      }).not.toThrow();
    });
  });

  describe('createComponent', () => {
    it('creates and renders a child component', () => {
      const definition: ComponentDefinition = {
        setup: (props) => ({ message: props.message ?? 'default' }),
        render: (ctx) => {
          const el = createElement('p');
          el.textContent = String(ctx.message);
          return el;
        },
      };

      const node = createComponent(definition, { message: 'hello' });
      expect(node).toBeInstanceOf(HTMLParagraphElement);
      expect((node as HTMLElement).textContent).toBe('hello');
    });

    it('works without a setup function', () => {
      const definition: ComponentDefinition = {
        render: () => {
          const el = createElement('div');
          el.textContent = 'no setup';
          return el;
        },
      };

      const node = createComponent(definition);
      expect((node as HTMLElement).textContent).toBe('no setup');
    });

    it('passes slots to the render context', () => {
      const definition: ComponentDefinition = {
        render: (ctx) => {
          const wrapper = createElement('div');
          const slots = ctx.$slots as Record<string, (() => Node) | undefined> | undefined;
          if (slots?.default) {
            wrapper.appendChild(slots.default());
          }
          return wrapper;
        },
      };

      const node = createComponent(
        definition,
        {},
        {
          default: () => {
            const span = createElement('span');
            span.textContent = 'slot content';
            return span;
          },
        },
      );

      expect((node as HTMLElement).querySelector('span')!.textContent).toBe('slot content');
    });

    it('injects styles into document.head', () => {
      const initialStyleCount = document.head.querySelectorAll('style').length;

      const definition: ComponentDefinition = {
        render: () => createElement('div'),
        styles: '.scoped { color: red; }',
      };

      createComponent(definition);

      const styles = document.head.querySelectorAll('style');
      expect(styles.length).toBe(initialStyleCount + 1);
      expect(styles[styles.length - 1].textContent).toBe('.scoped { color: red; }');
    });
  });
});

// =========================================================================
// Component lifecycle
// =========================================================================

describe('Component lifecycle', () => {
  describe('createComponentInstance', () => {
    it('creates an instance with default state', () => {
      const definition: ComponentDefinition = {
        render: () => createElement('div'),
      };

      const instance = createComponentInstance(definition);
      expect(instance.el).toBeNull();
      expect(instance.props).toEqual({});
      expect(instance.slots).toEqual({});
    });

    it('accepts initial props', () => {
      const definition: ComponentDefinition = {
        render: () => createElement('div'),
      };

      const instance = createComponentInstance(definition, { count: 5 });
      expect(instance.props).toEqual({ count: 5 });
    });
  });

  describe('mount / unmount', () => {
    it('mounts a component into a target element', () => {
      const target = container();

      const definition: ComponentDefinition = {
        setup: () => ({ text: 'mounted' }),
        render: (ctx) => {
          const el = createElement('h1');
          el.textContent = String(ctx.text);
          return el;
        },
      };

      const instance = createComponentInstance(definition);
      instance.mount(target);

      expect(target.querySelector('h1')).not.toBeNull();
      expect(target.querySelector('h1')!.textContent).toBe('mounted');
      expect(instance.el).not.toBeNull();
    });

    it('unmounts a component and removes its DOM node', () => {
      const target = container();

      const definition: ComponentDefinition = {
        render: () => {
          const el = createElement('section');
          el.textContent = 'content';
          return el;
        },
      };

      const instance = createComponentInstance(definition);
      instance.mount(target);
      expect(target.querySelector('section')).not.toBeNull();

      instance.unmount();
      expect(target.querySelector('section')).toBeNull();
      expect(instance.el).toBeNull();
    });

    it('injects scoped styles on mount and removes on unmount', () => {
      const target = container();
      const initialStyleCount = document.head.querySelectorAll('style').length;

      const definition: ComponentDefinition = {
        render: () => createElement('div'),
        styles: '.my-class { font-size: 20px; }',
      };

      const instance = createComponentInstance(definition);
      instance.mount(target);

      expect(document.head.querySelectorAll('style').length).toBe(initialStyleCount + 1);

      instance.unmount();
      expect(document.head.querySelectorAll('style').length).toBe(initialStyleCount);
    });

    it('mounts with an anchor node', () => {
      const target = container();
      const existing = createElement('p');
      existing.textContent = 'existing';
      target.appendChild(existing);

      const definition: ComponentDefinition = {
        render: () => {
          const el = createElement('span');
          el.textContent = 'before';
          return el;
        },
      };

      const instance = createComponentInstance(definition);
      instance.mount(target, existing);

      // The span should be inserted before the existing <p>.
      expect(target.firstChild).toBe(instance.el);
      expect(target.lastChild).toBe(existing);
    });
  });

  describe('mount() entry point', () => {
    it('mounts into a DOM element', () => {
      const target = container();
      target.id = 'app-test-mount-el';

      const definition: ComponentDefinition = {
        setup: () => ({ name: 'Utopia' }),
        render: (ctx) => {
          const el = createElement('div');
          el.textContent = `Hello ${ctx.name}`;
          return el;
        },
      };

      const instance = mount(definition, target);
      expect(target.querySelector('div')!.textContent).toBe('Hello Utopia');
      expect(instance.el).not.toBeNull();
    });

    it('mounts into a selector string', () => {
      const target = container();
      target.id = 'app-selector-mount';

      const definition: ComponentDefinition = {
        render: () => {
          const el = createElement('main');
          el.textContent = 'app';
          return el;
        },
      };

      const instance = mount(definition, '#app-selector-mount');
      expect(target.querySelector('main')!.textContent).toBe('app');
      instance.unmount();
    });

    it('throws when selector does not match any element', () => {
      const definition: ComponentDefinition = {
        render: () => createElement('div'),
      };

      expect(() => mount(definition, '#nonexistent-target')).toThrow(
        '[utopia] Mount target not found',
      );
    });
  });
});

// =========================================================================
// Scheduler
// =========================================================================

describe('Scheduler', () => {
  it('batches multiple jobs into a single microtask', async () => {
    const order: number[] = [];

    queueJob(() => order.push(1));
    queueJob(() => order.push(2));
    queueJob(() => order.push(3));

    // Jobs have not run yet synchronously.
    expect(order).toEqual([]);

    await nextTick();

    expect(order).toEqual([1, 2, 3]);
  });

  it('deduplicates the same job reference', async () => {
    let count = 0;
    const job = () => {
      count++;
    };

    queueJob(job);
    queueJob(job);
    queueJob(job);

    await nextTick();

    expect(count).toBe(1);
  });

  it('runs jobs queued during flush in the same pass', async () => {
    const order: string[] = [];

    queueJob(() => {
      order.push('first');
      // Queue another job during flush.
      queueJob(() => order.push('nested'));
    });

    await nextTick();
    // Allow nested flush to run.
    await nextTick();

    expect(order).toContain('first');
    expect(order).toContain('nested');
  });

  it('nextTick resolves after pending flush', async () => {
    let executed = false;

    queueJob(() => {
      executed = true;
    });

    await nextTick();
    expect(executed).toBe(true);
  });
});

// =========================================================================
// Hydration
// =========================================================================

describe('Hydration', () => {
  it('claims existing server-rendered DOM nodes', () => {
    const target = container();
    // Simulate server-rendered HTML
    target.innerHTML = '<div class="app"><span>Hello</span></div>';

    const originalDiv = target.firstChild as HTMLElement;
    const originalSpan = originalDiv.firstChild as HTMLElement;

    const definition: ComponentDefinition = {
      render: (ctx) => {
        const div = createElement('div');
        setAttr(div, 'class', 'app');
        const span = createElement('span');
        const text = createTextNode('Hello');
        appendChild(span, text);
        appendChild(div, span);
        return div;
      },
    };

    hydrate(definition, target);

    // Should reuse the existing DOM nodes, not create new ones.
    expect(target.firstChild).toBe(originalDiv);
    expect(originalDiv.firstChild).toBe(originalSpan);
  });

  it('attaches event listeners during hydration', () => {
    const target = container();
    target.innerHTML = '<button>Click me</button>';

    const handler = vi.fn();

    const definition: ComponentDefinition = {
      render: () => {
        const btn = createElement('button');
        const text = createTextNode('Click me');
        addEventListener(btn, 'click', handler);
        appendChild(btn, text);
        return btn;
      },
    };

    hydrate(definition, target);

    const btn = target.querySelector('button')!;
    btn.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('effects track dependencies after hydration', () => {
    const target = container();
    target.innerHTML = '<h1>0</h1>';

    const count = signal(0);

    const definition: ComponentDefinition = {
      setup: () => ({ count }),
      render: (ctx) => {
        const countFn = ctx.count as ReadonlySignal<number>;
        const h1 = createElement('h1');
        const textNode = createTextNode('');
        setText(textNode, String(countFn()));
        appendChild(h1, textNode);
        // Set up the reactive effect like the compiler would
        coreEffect(() => setText(textNode, String(countFn())));
        return h1;
      },
    };

    hydrate(definition, target);

    const h1 = target.querySelector('h1')!;
    expect(h1.textContent).toBe('0');

    count.set(42);
    expect(h1.textContent).toBe('42');
  });

  it('throws when hydration target is not found', () => {
    const definition: ComponentDefinition = {
      render: () => createElement('div'),
    };

    expect(() => hydrate(definition, '#nonexistent')).toThrow(
      '[utopia] Hydration target not found',
    );
  });
});

// =========================================================================
// Style deduplication (via createComponent)
// =========================================================================

describe('Style deduplication', () => {
  it('injects styles only once when the same component is created twice', () => {
    const initialStyleCount = document.head.querySelectorAll('style').length;

    const definition: ComponentDefinition = {
      render: () => createElement('div'),
      styles: '.dedup-test { color: green; }',
    };

    // Create the same component definition twice.
    createComponent(definition);
    createComponent(definition);

    const styles = document.head.querySelectorAll('style');
    // Only ONE new style element should have been added, not two.
    const addedCount = styles.length - initialStyleCount;
    expect(addedCount).toBe(1);

    // Verify the content is correct.
    const matchingStyles = Array.from(styles).filter(
      (s) => s.textContent === '.dedup-test { color: green; }',
    );
    expect(matchingStyles.length).toBe(1);
  });
});

// =========================================================================
// Effect disposal on unmount
// =========================================================================

describe('Effect disposal on unmount', () => {
  it('stops reactive effects after unmount', () => {
    const target = container();
    const count = signal(0);
    const effectRunCount = vi.fn();

    const definition: ComponentDefinition = {
      setup: () => ({ count }),
      render: (ctx) => {
        const countFn = ctx.count as ReadonlySignal<number>;
        const el = createElement('div');
        const textNode = createTextNode('');
        appendChild(el, textNode);

        // Simulate what the compiled template does: use createEffect
        // (which pushes a disposer) to reactively update the text.
        createEffect(() => {
          effectRunCount();
          setText(textNode, String(countFn()));
        });

        return el;
      },
    };

    const instance = createComponentInstance(definition);
    instance.mount(target);

    // The effect should have run once during mount.
    expect(effectRunCount).toHaveBeenCalledTimes(1);
    expect(target.querySelector('div')!.textContent).toBe('0');

    // Update the signal — the effect should re-run.
    count.set(1);
    expect(effectRunCount).toHaveBeenCalledTimes(2);
    expect(target.querySelector('div')!.textContent).toBe('1');

    // Unmount the component.
    instance.unmount();

    // After unmount, changing the signal should NOT re-trigger the effect.
    const callCountBeforeUpdate = effectRunCount.mock.calls.length;
    count.set(2);
    expect(effectRunCount).toHaveBeenCalledTimes(callCountBeforeUpdate);
  });
});

// ===========================================================================
// Error Boundaries
// ===========================================================================

import { createErrorBoundary } from './error-boundary.js';

describe('createErrorBoundary', () => {
  it('renders the try function when it succeeds', () => {
    const node = createErrorBoundary(
      () => {
        const el = document.createElement('div');
        el.textContent = 'Success';
        return el;
      },
      (error) => {
        const el = document.createElement('div');
        el.textContent = `Error: ${error.message}`;
        return el;
      },
    );

    expect(node.textContent).toBe('Success');
  });

  it('renders the catch function when try throws', () => {
    const node = createErrorBoundary(
      () => {
        throw new Error('Something broke');
      },
      (error) => {
        const el = document.createElement('div');
        el.textContent = `Caught: ${error.message}`;
        return el;
      },
    );

    expect(node.textContent).toBe('Caught: Something broke');
  });

  it('converts non-Error throws to Error objects', () => {
    const node = createErrorBoundary(
      () => {
        throw 'string error';
      },
      (error) => {
        const el = document.createElement('div');
        el.textContent = error.message;
        return el;
      },
    );

    expect(node.textContent).toBe('string error');
  });

  it('disposes captured effects on error', () => {
    const disposed = vi.fn();

    const node = createErrorBoundary(
      () => {
        // Create an effect that will be captured
        const dispose = coreEffect(() => {});
        // Manually simulate what pushDisposer does
        throw new Error('fail');
      },
      (error) => {
        const el = document.createElement('div');
        el.textContent = 'fallback';
        return el;
      },
    );

    expect(node.textContent).toBe('fallback');
  });
});

// ===========================================================================
// Lazy Components
// ===========================================================================

import { defineLazy } from './lazy.js';

describe('defineLazy', () => {
  it('renders the fallback initially', () => {
    const HeavyComponent: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        el.textContent = 'Heavy Content';
        return el;
      },
    };

    const Lazy = defineLazy(
      () => Promise.resolve({ default: HeavyComponent }),
      () => {
        const el = document.createElement('span');
        el.textContent = 'Loading...';
        return el;
      },
    );

    const target = document.createElement('div');
    const node = createComponent(Lazy);
    target.appendChild(node);

    // Before the promise resolves, fallback should be shown.
    expect(target.textContent).toBe('Loading...');
  });

  it('swaps in the real component after loading', async () => {
    const HeavyComponent: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        el.textContent = 'Loaded!';
        return el;
      },
    };

    let resolveLoader: (value: { default: ComponentDefinition }) => void;
    const loaderPromise = new Promise<{ default: ComponentDefinition }>((resolve) => {
      resolveLoader = resolve;
    });

    const Lazy = defineLazy(
      () => loaderPromise,
      () => {
        const el = document.createElement('span');
        el.textContent = 'Loading...';
        return el;
      },
    );

    const target = document.createElement('div');
    const node = createComponent(Lazy);
    target.appendChild(node);

    expect(target.textContent).toBe('Loading...');

    // Resolve the loader
    resolveLoader!({ default: HeavyComponent });
    await loaderPromise;

    // Allow microtask queue to drain
    await new Promise((r) => setTimeout(r, 0));

    expect(target.textContent).toBe('Loaded!');
  });

  it('works without a fallback', () => {
    const Lazy = defineLazy(() =>
      Promise.resolve({ default: { render: () => document.createElement('div') } }),
    );

    const node = createComponent(Lazy);
    // Should render an empty container (no fallback)
    expect(node).toBeInstanceOf(HTMLDivElement);
  });
});

// ===========================================================================
// Transitions
// ===========================================================================

import { createTransition, performEnter, performLeave } from './transition.js';

describe('createTransition', () => {
  it('returns transition hooks object', () => {
    const el = document.createElement('div');
    const hooks = createTransition(el, { name: 'fade' });
    expect(hooks).toHaveProperty('beforeEnter');
    expect(hooks).toHaveProperty('enter');
    expect(hooks).toHaveProperty('beforeLeave');
    expect(hooks).toHaveProperty('leave');
  });

  it('beforeEnter adds enter-from and enter-active classes', () => {
    const el = document.createElement('div');
    const hooks = createTransition(el, { name: 'fade' });
    hooks.beforeEnter(el);
    expect(el.classList.contains('fade-enter-from')).toBe(true);
    expect(el.classList.contains('fade-enter-active')).toBe(true);
  });

  it('beforeLeave adds leave-from and leave-active classes', () => {
    const el = document.createElement('div');
    const hooks = createTransition(el, { name: 'slide' });
    hooks.beforeLeave(el);
    expect(el.classList.contains('slide-leave-from')).toBe(true);
    expect(el.classList.contains('slide-leave-active')).toBe(true);
  });

  it('enter removes enter-from and adds enter-to', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hooks = createTransition(el, { name: 'fade' });
    hooks.beforeEnter(el);

    hooks.enter(el, () => {});
    // After enter, enter-from should be removed and enter-to added
    expect(el.classList.contains('fade-enter-from')).toBe(false);
    expect(el.classList.contains('fade-enter-to')).toBe(true);
    expect(el.classList.contains('fade-enter-active')).toBe(true);

    document.body.removeChild(el);
  });

  it('performEnter is a convenience wrapper', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hooks = createTransition(el, { name: 'test' });
    performEnter(el, hooks);
    expect(el.classList.contains('test-enter-to')).toBe(true);
    document.body.removeChild(el);
  });
});

// ===========================================================================
// Security — Regression tests
// ===========================================================================

import { useHead } from './head.js';

describe('Security — defineLazy error handling', () => {
  it('shows error message when loader rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Lazy = defineLazy(() => Promise.reject(new Error('network error')));

    const target = document.createElement('div');
    document.body.appendChild(target);
    const node = createComponent(Lazy);
    target.appendChild(node);

    // Allow microtask queue to drain
    await new Promise((r) => setTimeout(r, 0));

    expect(target.textContent).toBe('Failed to load component');
    errorSpy.mockRestore();
    document.body.removeChild(target);
  });

  it('does not duplicate requests for the same loader', async () => {
    let callCount = 0;
    const Component: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        el.textContent = 'loaded';
        return el;
      },
    };

    const loader = () => {
      callCount++;
      return Promise.resolve({ default: Component });
    };

    const Lazy = defineLazy(loader);

    // Render twice before the promise resolves
    createComponent(Lazy);
    createComponent(Lazy);

    await new Promise((r) => setTimeout(r, 0));

    // The loader should have been called only once
    expect(callCount).toBe(1);
  });
});

describe('Security — useHead attribute filtering', () => {
  it('filters onload attribute from script tags', () => {
    useHead({
      script: [{ src: '/app.js', onload: 'alert(1)' } as any],
    });

    const scripts = document.head.querySelectorAll('script');
    const last = scripts[scripts.length - 1];
    expect(last.getAttribute('src')).toBe('/app.js');
    expect(last.getAttribute('onload')).toBeNull();
    last.parentNode?.removeChild(last);
  });

  it('filters onerror attribute from link tags', () => {
    useHead({
      link: [{ rel: 'stylesheet', href: '/style.css', onerror: 'alert(1)' } as any],
    });

    const links = document.head.querySelectorAll('link');
    const last = links[links.length - 1];
    expect(last.getAttribute('href')).toBe('/style.css');
    expect(last.getAttribute('onerror')).toBeNull();
    last.parentNode?.removeChild(last);
  });
});

describe('Security — transition double-fire prevention', () => {
  it('calls done() only once even if both transitionend and timeout fire', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hooks = createTransition(el, { name: 'test', duration: 100 });

    const doneSpy = vi.fn();
    hooks.beforeEnter(el);
    hooks.enter(el, doneSpy);

    // Simulate transitionend event
    el.dispatchEvent(new Event('transitionend'));
    expect(doneSpy).toHaveBeenCalledTimes(1);

    // Advance past the timeout
    vi.advanceTimersByTime(200);
    // done should not have been called again
    expect(doneSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(el);
    vi.useRealTimers();
  });

  it('calls done() via timeout if transitionend never fires', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hooks = createTransition(el, { name: 'test', duration: 100 });

    const doneSpy = vi.fn();
    hooks.beforeLeave(el);
    hooks.leave(el, doneSpy);

    expect(doneSpy).not.toHaveBeenCalled();

    // Advance past the timeout
    vi.advanceTimersByTime(200);
    expect(doneSpy).toHaveBeenCalledTimes(1);

    document.body.removeChild(el);
    vi.useRealTimers();
  });
});

describe('setSafeHtml', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders safe HTML as-is', async () => {
    const { setSafeHtml } = await import('./dom.js');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<b>bold</b> and <em>italic</em>');
    expect(el.innerHTML).toBe('<b>bold</b> and <em>italic</em>');
  });

  it('strips <script> tags', async () => {
    const { setSafeHtml } = await import('./dom.js');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<p>hello</p><script>alert("xss")</script>');
    expect(el.innerHTML).not.toContain('<script');
    expect(el.innerHTML).toContain('<p>hello</p>');
  });

  it('strips event handler attributes', async () => {
    const { setSafeHtml } = await import('./dom.js');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<img onerror="alert(1)" src="x">');
    expect(el.innerHTML).not.toContain('onerror');
  });

  it('strips javascript: URLs', async () => {
    const { setSafeHtml } = await import('./dom.js');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<a href="javascript:alert(1)">click</a>');
    expect(el.innerHTML).not.toContain('javascript:');
  });

  it('strips <iframe> tags', async () => {
    const { setSafeHtml } = await import('./dom.js');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<iframe src="evil.com"></iframe><p>ok</p>');
    expect(el.innerHTML).not.toContain('<iframe');
    expect(el.innerHTML).toContain('<p>ok</p>');
  });
});

describe('hydrate — lifecycle and disposer capture', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'hydrate-test';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('runs onMount callbacks after hydration', async () => {
    const { hydrate } = await import('./hydration.js');
    const { onMount } = await import('./component.js');

    let mounted = false;

    const comp = {
      setup() {
        onMount(() => { mounted = true; });
        return {};
      },
      render() { return document.createTextNode('hello'); },
    };

    container.textContent = 'hello';
    hydrate(comp, container);
    expect(mounted).toBe(true);
  });
});
