/**
 * @utopia/runtime — Test suite
 *
 * Uses vitest with jsdom (configured in the root vitest.config.ts).
 * The @utopia/core package is resolved via the vitest alias to its source,
 * so no build step is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signal, effect as coreEffect } from '@utopia/core';

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
      const node = createTextNode(42 as any);
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
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        CharacterData.prototype,
        'data',
      )!;
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
      el = createElement('div');
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
      const el = createElement('button');
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
      const el = createElement('div');
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
  });

  describe('createComponent', () => {
    it('creates and renders a child component', () => {
      const definition: ComponentDefinition = {
        setup: (props) => ({ message: props.message ?? 'default' }),
        render: (ctx) => {
          const el = createElement('p');
          el.textContent = ctx.message;
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
          if (ctx.$slots && ctx.$slots.default) {
            wrapper.appendChild(ctx.$slots.default());
          }
          return wrapper;
        },
      };

      const node = createComponent(definition, {}, {
        default: () => {
          const span = createElement('span');
          span.textContent = 'slot content';
          return span;
        },
      });

      expect(
        (node as HTMLElement).querySelector('span')!.textContent,
      ).toBe('slot content');
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
      expect(styles[styles.length - 1].textContent).toBe(
        '.scoped { color: red; }',
      );
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
          el.textContent = ctx.text;
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
      const initialStyleCount =
        document.head.querySelectorAll('style').length;

      const definition: ComponentDefinition = {
        render: () => createElement('div'),
        styles: '.my-class { font-size: 20px; }',
      };

      const instance = createComponentInstance(definition);
      instance.mount(target);

      expect(document.head.querySelectorAll('style').length).toBe(
        initialStyleCount + 1,
      );

      instance.unmount();
      expect(document.head.querySelectorAll('style').length).toBe(
        initialStyleCount,
      );
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
        const h1 = createElement('h1');
        const textNode = createTextNode('');
        setText(textNode, String(ctx.count()));
        appendChild(h1, textNode);
        // Set up the reactive effect like the compiler would
        coreEffect(() => setText(textNode, String(ctx.count())));
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
