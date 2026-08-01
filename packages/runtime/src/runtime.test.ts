/**
 * @matthesketh/utopia-runtime — Test suite
 *
 * Uses vitest with jsdom (configured in the root vitest.config.ts).
 * The @matthesketh/utopia-core package is resolved via the vitest alias to its source,
 * so no build step is required.
 */

import {
  effect as coreEffect,
  flushSync,
  type ReadonlySignal,
  signal,
  tick as flushDom,
} from '@matthesketh/utopia-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComponentDefinition } from '@/component';
import {
  createComponentInstance,
  mount,
  startCapturingDisposers,
  stopCapturingDisposers,
} from '@/component';
import { createComponent, createFor, createIf } from '@/directives';
import {
  addEventListener,
  appendChild,
  createComment,
  createElement,
  createTextNode,
  insertBefore,
  mergeClass,
  removeNode,
  setAttr,
  setText,
} from '@/dom';
import { hydrate } from '@/hydration';
import { createEffect } from '@/index';
import { nextTick, queueJob } from '@/scheduler';

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

    it('updates the live value property of a typed-in input', () => {
      // after user input the value attribute detaches from the property; a
      // bound :value patch must still reach the screen (autosuggest picks,
      // programmatic form fills).
      const input = createElement('input') as HTMLInputElement;
      input.value = 'cre';
      setAttr(input, 'value', 'Creatine monohydrate');
      expect(input.value).toBe('Creatine monohydrate');
      expect(input.getAttribute('value')).toBe('Creatine monohydrate');
    });

    it('leaves the caret-preserving path alone when value is unchanged', () => {
      const input = createElement('input') as HTMLInputElement;
      input.value = 'same';
      const spy = vi.spyOn(input, 'value', 'set');
      setAttr(input, 'value', 'same');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('clears a form value bound to null', () => {
      const input = createElement('input') as HTMLInputElement;
      input.value = 'stale';
      setAttr(input, 'value', null);
      expect(input.value).toBe('');
      expect(input.hasAttribute('value')).toBe(false);
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

    // ---- keyed reconciliation -----------------------------------------
    // these tests verify the property that motivates the rewrite: when the
    // list signal is replaced with a new array whose items are still
    // identifiable, the existing dom nodes are reused rather than torn down
    // and rebuilt. without this, every refetch in a consuming app caused
    // visible flicker, lost focus, and dropped taps mid-gesture.

    it('reuses dom nodes when the list is replaced with the same keys', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
      ]);

      createFor(
        anchor,
        () => items(),
        (item) => {
          const li = createElement('li');
          li.textContent = `${item.id}:${item.n}`;
          return li;
        },
        (item) => item.id,
      );

      const before = Array.from(parent.querySelectorAll('li'));
      // refetch returning a structurally identical list
      items.set([
        { id: 'a', n: 1 },
        { id: 'b', n: 2 },
      ]);
      const after = Array.from(parent.querySelectorAll('li'));
      expect(after).toHaveLength(2);
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
    });

    it('only adds the new node when an item is appended', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);
      const items = signal([{ id: 'a' }, { id: 'b' }]);
      createFor(
        anchor,
        () => items(),
        (item) => {
          const li = createElement('li');
          li.textContent = String(item.id);
          return li;
        },
        (item) => item.id,
      );
      const [a, b] = Array.from(parent.querySelectorAll('li'));
      items.set([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      const after = Array.from(parent.querySelectorAll('li'));
      expect(after).toHaveLength(3);
      expect(after[0]).toBe(a);
      expect(after[1]).toBe(b);
      expect(after[2]?.textContent).toBe('c');
    });

    it('only removes the gone node when an item is deleted', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);
      const items = signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      createFor(
        anchor,
        () => items(),
        (item) => {
          const li = createElement('li');
          li.textContent = String(item.id);
          return li;
        },
        (item) => item.id,
      );
      const [a, , c] = Array.from(parent.querySelectorAll('li'));
      items.set([{ id: 'a' }, { id: 'c' }]);
      const after = Array.from(parent.querySelectorAll('li'));
      expect(after).toHaveLength(2);
      expect(after[0]).toBe(a);
      expect(after[1]).toBe(c);
    });

    it('moves nodes to match a reordered list without recreating them', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);
      const items = signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      createFor(
        anchor,
        () => items(),
        (item) => {
          const li = createElement('li');
          li.textContent = String(item.id);
          return li;
        },
        (item) => item.id,
      );
      const [a, b, c] = Array.from(parent.querySelectorAll('li'));
      items.set([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
      const after = Array.from(parent.querySelectorAll('li'));
      expect(after).toHaveLength(3);
      expect(after[0]).toBe(c);
      expect(after[1]).toBe(a);
      expect(after[2]).toBe(b);
    });

    it('falls back to identity equality when no key callback is given', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);
      const a = { n: 1 };
      const b = { n: 2 };
      const items = signal([a, b]);
      createFor(
        anchor,
        () => items(),
        (item) => {
          const li = createElement('li');
          li.textContent = String(item.n);
          return li;
        },
      );
      const [first, second] = Array.from(parent.querySelectorAll('li'));
      // same references → both nodes preserved
      items.set([a, b]);
      const after = Array.from(parent.querySelectorAll('li'));
      expect(after[0]).toBe(first);
      expect(after[1]).toBe(second);
    });

    it('keeps click handlers firing on reused nodes after a list re-render', () => {
      // regression test for the bottom-nav scenario: tapping a tab worked
      // on first render but stopped firing after any signal-driven list
      // update unless the rendered node was reused with its handler intact.
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([{ id: 'home' }, { id: 'food' }, { id: 'body' }]);
      const clicks: string[] = [];

      createFor(
        anchor,
        () => items(),
        (item) => {
          const btn = createElement('button') as HTMLButtonElement;
          btn.id = `btn-${item.id}`;
          btn.addEventListener('click', () => clicks.push(item.id));
          return btn;
        },
        (item) => item.id,
      );

      const foodBtn = parent.querySelector('#btn-food') as HTMLButtonElement;
      foodBtn.click();
      expect(clicks).toEqual(['food']);

      // re-emit the same array shape with a new reference (what the layout
      // does every time `navItems()` is invoked thanks to the spread).
      items.set([{ id: 'home' }, { id: 'food' }, { id: 'body' }]);
      const foodAfter = parent.querySelector('#btn-food') as HTMLButtonElement;
      expect(foodAfter).toBe(foodBtn);
      foodAfter.click();
      expect(clicks).toEqual(['food', 'food']);
    });

    it('disposes effects of removed items but leaves kept items running', async () => {
      // motivation: a removed list row's `:class="x()"` binding must stop
      // firing — otherwise it tries to mutate a detached node forever.
      // a kept row's binding must keep firing — otherwise reactive bindings
      // inside the row appear "dead" after the next list update.
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([{ id: 'a' }, { id: 'b' }]);
      const tick = signal(0);
      const renders: Record<string, number> = { a: 0, b: 0 };

      // wrap createFor with a captured-disposer scope, mirroring how a
      // component's render() invokes it: each renderItem's createEffect
      // calls push their disposer onto the scope, scoped per-item.
      const prev = startCapturingDisposers();
      try {
        createFor(
          anchor,
          () => items(),
          (item) => {
            const div = createElement('div');
            div.id = `row-${item.id}`;
            createEffect(() => {
              tick();
              renders[item.id] = (renders[item.id] ?? 0) + 1;
            });
            return div;
          },
          (item) => item.id,
        );
      } finally {
        stopCapturingDisposers(prev);
      }

      const baseA = renders.a;
      const baseB = renders.b;
      // remove 'a'; tick should now only re-run 'b's effect.
      items.set([{ id: 'b' }]);
      tick.set(tick() + 1);
      await flushDom();
      expect(renders.a).toBe(baseA);
      expect(renders.b).toBeGreaterThan(baseB);
    });

    it('preserves user input on a kept node across re-renders', () => {
      // this is the regression that motivated keyed reconciliation: an input
      // inside a list row used to lose focus and discard typed text every
      // time the parent list signal was reassigned.
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);
      const items = signal([{ id: 'a' }, { id: 'b' }]);
      createFor(
        anchor,
        () => items(),
        (item) => {
          const div = createElement('div');
          const input = createElement('input') as HTMLInputElement;
          input.id = `input-${item.id}`;
          div.appendChild(input);
          return div;
        },
        (item) => item.id,
      );
      const inputA = parent.querySelector('#input-a') as HTMLInputElement;
      inputA.value = 'typed';
      // identical list — under the old non-keyed strategy this wiped the dom
      items.set([{ id: 'a' }, { id: 'b' }]);
      const after = parent.querySelector('#input-a') as HTMLInputElement;
      expect(after).toBe(inputA);
      expect(after.value).toBe('typed');
    });

    // -----------------------------------------------------------------
    // reactive loop variable (ForItemScope)
    // -----------------------------------------------------------------
    // reuse alone left a row rendering the item it was FIRST given: keying
    // by `item.id` means the canonical immutable update
    // (items.map(x => ({ ...x, name }))) arrives as a new object under an
    // existing key, and a binding that closed over the old object had no
    // signal to re-run on. the row scope closes that: createFor rebinds the
    // loop variables and bumps the row's version, and the row's effects —
    // which called scope.track — re-run against the new item on the SAME
    // node. these renderItem functions are written in the shape the compiler
    // emits (see the codegen tests in the compiler package).

    it('rebinds a reused row to the item it now holds', async () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([{ id: 'a', name: 'alpha' }]);

      createFor(
        anchor,
        () => items(),
        (item, _index, scope) => {
          const track = scope.track;
          scope.onUpdate((nextItem) => {
            item = nextItem;
          });
          const li = createElement('li');
          createEffect(() => {
            track();
            li.textContent = item.name;
          });
          return li;
        },
        (item) => item.id,
      );

      const li = parent.querySelector('li') as HTMLElement;
      expect(li.textContent).toBe('alpha');

      items.set([{ id: 'a', name: 'alpha-2' }]);
      expect(parent.querySelector('li')).toBe(li);
      await flushDom();
      expect(li.textContent).toBe('alpha-2');
    });

    it('rebinds the index of a reused row after a reorder', async () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const a = { id: 'a' };
      const b = { id: 'b' };
      const items = signal([a, b]);

      createFor(
        anchor,
        () => items(),
        (item, index, scope) => {
          const track = scope.track;
          scope.onUpdate((nextItem, nextIndex) => {
            item = nextItem;
            index = nextIndex;
          });
          const li = createElement('li');
          li.id = `reorder-${item.id}`;
          createEffect(() => {
            track();
            li.textContent = `${index}:${item.id}`;
          });
          return li;
        },
        (item) => item.id,
      );

      const rowA = parent.querySelector('#reorder-a') as HTMLElement;
      expect(rowA.textContent).toBe('0:a');

      // same objects, reversed — the nodes are moved, not rebuilt.
      items.set([b, a]);
      expect(parent.querySelector('#reorder-a')).toBe(rowA);
      await flushDom();
      expect(rowA.textContent).toBe('1:a');
      expect((parent.querySelector('#reorder-b') as HTMLElement).textContent).toBe('0:b');
    });

    it('wakes a reused row even when the item is the identical object', async () => {
      // the row cannot tell an in-place mutation from a replacement, so the
      // version bump is unconditional: a list update always re-evaluates the
      // rows it kept.
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const only = { id: 'a', name: 'alpha' };
      const items = signal([only]);

      createFor(
        anchor,
        () => items(),
        (item, _index, scope) => {
          const track = scope.track;
          scope.onUpdate((nextItem) => {
            item = nextItem;
          });
          const li = createElement('li');
          createEffect(() => {
            track();
            li.textContent = item.name;
          });
          return li;
        },
        (item) => item.id,
      );

      only.name = 'mutated';
      items.set([only]);
      await flushDom();
      expect((parent.querySelector('li') as HTMLElement).textContent).toBe('mutated');
    });

    it('does not refresh a row it removed', () => {
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([{ id: 'a' }, { id: 'b' }]);
      const refreshes: Record<string, number> = { a: 0, b: 0 };

      createFor(
        anchor,
        () => items(),
        (item, _index, scope) => {
          scope.onUpdate((nextItem) => {
            refreshes[nextItem.id] = (refreshes[nextItem.id] ?? 0) + 1;
          });
          return createElement('li');
        },
        (item) => item.id,
      );

      items.set([{ id: 'a' }]);
      expect(refreshes).toEqual({ a: 1, b: 0 });
      items.set([{ id: 'a' }]);
      expect(refreshes).toEqual({ a: 2, b: 0 });
    });

    it('still renders a renderItem that ignores the scope', () => {
      // hand-written callers (and code compiled before the scope existed)
      // pass a two-parameter renderItem — it must keep working, unchanged.
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([{ id: 'a', name: 'alpha' }]);

      createFor(
        anchor,
        () => items(),
        (item) => {
          const li = createElement('li');
          li.textContent = item.name;
          return li;
        },
        (item) => item.id,
      );

      const li = parent.querySelector('li') as HTMLElement;
      items.set([{ id: 'a', name: 'alpha-2' }]);
      // reused, so still the original node and the original text — the
      // pre-scope behaviour, not a crash.
      expect(parent.querySelector('li')).toBe(li);
      expect(li.textContent).toBe('alpha');
    });

    it('keeps focus and caret in a reused row while its value updates', async () => {
      // the case the fix exists for: a grams input inside a row whose list is
      // rebuilt immutably on every keystroke. the row is reused, so the input
      // keeps focus and caret — and the row's bindings still update.
      const parent = container();
      const anchor = document.createComment('for');
      parent.appendChild(anchor);

      const items = signal([
        { id: 'a', grams: '10' },
        { id: 'b', grams: '20' },
      ]);

      createFor(
        anchor,
        () => items(),
        (item, _index, scope) => {
          const track = scope.track;
          scope.onUpdate((nextItem) => {
            item = nextItem;
          });
          const input = createElement('input') as HTMLInputElement;
          input.id = `grams-${item.id}`;
          createEffect(() => {
            track();
            setAttr(input, 'value', item.grams);
          });
          return input;
        },
        (item) => item.id,
      );

      const first = parent.querySelector('#grams-a') as HTMLInputElement;
      first.focus();
      first.setSelectionRange(1, 1);
      expect(document.activeElement).toBe(first);

      items.set([
        { id: 'a', grams: '10' },
        { id: 'b', grams: '99' },
      ]);

      // node identity, focus and caret survive the reconcile immediately (it is
      // synchronous); the VALUE binding lands on the microtask.
      expect(parent.querySelector('#grams-a')).toBe(first);
      expect(document.activeElement).toBe(first);
      expect(first.selectionStart).toBe(1);
      await flushDom();
      expect(document.activeElement).toBe(first);
      expect(first.selectionStart).toBe(1);
      expect((parent.querySelector('#grams-b') as HTMLInputElement).value).toBe('99');
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
      render: () => {
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
  it('stops reactive effects after unmount', async () => {
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
    await flushDom();
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

import { createErrorBoundary } from '@/error-boundary';

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

  // NOTE: real effect-disposal behaviour is asserted in
  // "createErrorBoundary — effect disposal" further down.
});

// ===========================================================================
// Lazy Components
// ===========================================================================

import { defineLazy } from '@/lazy';

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

import { createTransition, performEnter, performLeave } from '@/transition';

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
    // completing the transition cleans the classes up via the no-op done.
    el.dispatchEvent(new Event('transitionend'));
    expect(el.classList.contains('test-enter-to')).toBe(false);
    expect(el.classList.contains('test-enter-active')).toBe(false);
    document.body.removeChild(el);
  });
});

// ===========================================================================
// Security — Regression tests
// ===========================================================================

import { useHead } from '@/head';

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
    const { setSafeHtml } = await import('./dom');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<b>bold</b> and <em>italic</em>');
    expect(el.innerHTML).toBe('<b>bold</b> and <em>italic</em>');
  });

  it('strips <script> tags', async () => {
    const { setSafeHtml } = await import('./dom');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<p>hello</p><script>alert("xss")</script>');
    expect(el.innerHTML).not.toContain('<script');
    expect(el.innerHTML).toContain('<p>hello</p>');
  });

  it('strips event handler attributes', async () => {
    const { setSafeHtml } = await import('./dom');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<img onerror="alert(1)" src="x">');
    expect(el.innerHTML).not.toContain('onerror');
  });

  it('strips javascript: URLs', async () => {
    const { setSafeHtml } = await import('./dom');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<a href="javascript:alert(1)">click</a>');
    expect(el.innerHTML).not.toContain('javascript:');
  });

  it('strips <iframe> tags', async () => {
    const { setSafeHtml } = await import('./dom');
    const el = document.createElement('div');
    container.appendChild(el);
    setSafeHtml(el, () => '<iframe src="evil.com"></iframe><p>ok</p>');
    expect(el.innerHTML).not.toContain('<iframe');
    expect(el.innerHTML).toContain('<p>ok</p>');
  });
});

// SEC-0001 regression tests — bypass vectors that defeated the old regex sanitizer
describe('sanitizeHtml — SEC-0001 bypass regression tests', () => {
  it('strips onerror with slash separator (bypass 1: EVENT_ATTR_RE whitespace assumption)', async () => {
    const { sanitizeHtml } = await import('./dom');
    const result = sanitizeHtml('<img/src=x/onerror=alert(1)>');
    // the security property is "no live event-handler attribute survives", not
    // "the substring onerror is absent": depending on the html parser the
    // `/`-separated tokens parse either as a single benign `src` value (the
    // literal "onerror" then appears inside a non-executing url) or as a
    // distinct `onerror` attribute. either way no on* attribute may remain.
    const doc = new DOMParser().parseFromString(result, 'text/html');
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      }
    }
  });

  it('strips svg onload with slash separator (bypass 2: svg not in old UNSAFE_TAGS_RE)', async () => {
    const { sanitizeHtml } = await import('./dom');
    const result = sanitizeHtml('<svg/onload=alert(1)>');
    expect(result).not.toContain('onload');
  });

  it('strips nested script tag breakout (bypass 3: <scr<script>ipt> reconstruction)', async () => {
    const { sanitizeHtml } = await import('./dom');
    const result = sanitizeHtml('<scr<script>ipt>alert(1)</script>');
    expect(result).not.toMatch(/<script/i);
    expect(result).not.toContain('ipt>alert(1)');
  });

  it('strips javascript: URI in style attribute (bypass 4: style not covered by old DANGEROUS_URI_RE)', async () => {
    const { sanitizeHtml } = await import('./dom');
    const result = sanitizeHtml('<p style="background:url(\'javascript:alert(1)\')">hello</p>');
    expect(result).not.toContain('javascript:');
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
    const { hydrate } = await import('./hydration');
    const { onMount } = await import('./component');

    let mounted = false;

    const comp = {
      setup() {
        onMount(() => {
          mounted = true;
        });
        return {};
      },
      render() {
        return document.createTextNode('hello');
      },
    };

    container.textContent = 'hello';
    hydrate(comp, container);
    expect(mounted).toBe(true);
  });
});

describe('mergeClass', () => {
  it('joins static and dynamic strings', () => {
    expect(mergeClass('chip', 'on')).toBe('chip on');
    expect(mergeClass('chip', '')).toBe('chip');
    expect(mergeClass('chip', null)).toBe('chip');
  });

  it('joins truthy object keys', () => {
    expect(mergeClass('dot', { on: true, miss: false })).toBe('dot on');
    expect(mergeClass('', { on: true })).toBe('on');
  });
});

// =========================================================================
// Coverage: error paths, cleanup paths, and rarely-taken branches
// =========================================================================

import { onDestroy, stopCapturingLifecycle } from './component';
import { setHtml, setSafeHtml } from './dom';

describe('useHead — full config and cleanup', () => {
  it('sets title/meta/link/script and removes them all on unmount', () => {
    const originalTitle = document.title;
    const target = container();

    const def: ComponentDefinition = {
      render: () => {
        useHead({
          title: 'Test Page',
          meta: [
            { name: 'description', content: 'a test' },
            { property: 'og:title', content: 'Test Page' },
          ],
          link: [{ rel: 'canonical', href: 'https://x.test/page' }],
          script: [{ src: '/head-test.js', type: 'module' }],
        });
        return createElement('div');
      },
    };

    const instance = createComponentInstance(def);
    instance.mount(target);

    expect(document.title).toBe('Test Page');
    expect(document.head.querySelector('meta[name="description"]')!.getAttribute('content')).toBe(
      'a test',
    );
    expect(document.head.querySelector('meta[property="og:title"]')!.getAttribute('content')).toBe(
      'Test Page',
    );
    expect(document.head.querySelector('link[rel="canonical"]')!.getAttribute('href')).toBe(
      'https://x.test/page',
    );
    expect(document.head.querySelector('script[src="/head-test.js"]')!.getAttribute('type')).toBe(
      'module',
    );

    instance.unmount();
    expect(document.title).toBe(originalTitle);
    expect(document.head.querySelector('meta[name="description"]')).toBeNull();
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('script[src="/head-test.js"]')).toBeNull();
    target.remove();
  });

  it('tolerates injected elements that were already removed externally', () => {
    const target = container();
    const def: ComponentDefinition = {
      render: () => {
        useHead({ meta: [{ name: 'ext-removed', content: 'x' }] });
        return createElement('div');
      },
    };
    const instance = createComponentInstance(def);
    instance.mount(target);

    const el = document.head.querySelector('meta[name="ext-removed"]')!;
    el.parentNode!.removeChild(el); // removed by something else first

    expect(() => instance.unmount()).not.toThrow();
    target.remove();
  });

  it('leaves the document title untouched when no title is configured', () => {
    document.title = 'Keep Me';
    const target = container();

    const def: ComponentDefinition = {
      render: () => {
        useHead({ meta: [{ name: 'x', content: 'y' }] });
        return createElement('div');
      },
    };

    const instance = createComponentInstance(def);
    instance.mount(target);
    document.title = 'Changed Meanwhile';
    instance.unmount();

    // no title config → cleanup must not restore/overwrite the title.
    expect(document.title).toBe('Changed Meanwhile');
    target.remove();
  });
});

describe('createErrorBoundary — effect disposal', () => {
  it('exposes a cleanup on the success node that disposes captured effects', () => {
    const s = signal(0);
    let runs = 0;

    const node = createErrorBoundary(
      () => {
        createEffect(() => {
          s();
          runs++;
        });
        return document.createElement('div');
      },
      () => document.createElement('span'),
    );

    expect(runs).toBe(1);
    flushSync(() => s.set(1));
    expect(runs).toBe(2);

    (node as unknown as { __cleanup: () => void }).__cleanup();
    flushSync(() => s.set(2));
    expect(runs).toBe(2); // disposed
  });

  it('disposes effects created before the render error', () => {
    const s = signal(0);
    let runs = 0;

    const node = createErrorBoundary(
      () => {
        createEffect(() => {
          s();
          runs++;
        });
        throw new Error('render exploded');
      },
      (error) => {
        const el = document.createElement('div');
        el.textContent = error.message;
        return el;
      },
    );

    expect(node.textContent).toBe('render exploded');
    expect(runs).toBe(1);
    s.set(1);
    expect(runs).toBe(1); // the partially-created effect was disposed
  });
});

describe('defineLazy — cache and error branches', () => {
  it('renders synchronously from the module cache on subsequent mounts', async () => {
    const Cached: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        el.textContent = 'from cache';
        return el;
      },
    };
    const loader = () => Promise.resolve({ default: Cached });
    const Lazy = defineLazy(loader);

    createComponent(Lazy); // first mount triggers the load
    await new Promise((r) => setTimeout(r, 0));

    const second = createComponent(Lazy) as HTMLElement;
    // no lazy container: the cached component's node is returned directly.
    expect(second.textContent).toBe('from cache');
    expect(second.hasAttribute('data-utopia-lazy')).toBe(false);
  });

  it('replaces the fallback with an error message when the loader rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Lazy = defineLazy(
      () => Promise.reject(new Error('boom')),
      () => {
        const el = document.createElement('span');
        el.textContent = 'Loading...';
        return el;
      },
    );

    const target = container();
    const node = createComponent(Lazy);
    target.appendChild(node);
    expect(target.textContent).toBe('Loading...');

    await new Promise((r) => setTimeout(r, 0));
    expect(target.textContent).toBe('Failed to load component');
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    target.remove();
  });

  it('does not render the error message into a detached container', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Lazy = defineLazy(
      () => Promise.reject(new Error('boom')),
      () => {
        const el = document.createElement('span');
        el.textContent = 'Loading...';
        return el;
      },
    );

    const node = createComponent(Lazy) as HTMLElement; // never attached
    await new Promise((r) => setTimeout(r, 0));

    // container was detached — left untouched (fallback still present).
    expect(node.textContent).toBe('Loading...');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('transitions — leave phase and no-duration branches', () => {
  it('performLeave runs the leave phase and calls done', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hooks = createTransition(el, { name: 't' });

    const done = vi.fn();
    performLeave(el, hooks, done);
    expect(el.classList.contains('t-leave-to')).toBe(true);
    expect(done).not.toHaveBeenCalled();

    el.dispatchEvent(new Event('transitionend'));
    expect(done).toHaveBeenCalledTimes(1);
    expect(el.classList.contains('t-leave-active')).toBe(false);
    expect(el.classList.contains('t-leave-to')).toBe(false);

    document.body.removeChild(el);
  });

  it('without a duration, done fires once even for repeated transitionend events', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hooks = createTransition(el, { name: 'nd' });

    const done = vi.fn();
    hooks.beforeEnter(el);
    hooks.enter(el, done);

    el.dispatchEvent(new Event('transitionend'));
    el.dispatchEvent(new Event('transitionend'));
    expect(done).toHaveBeenCalledTimes(1);

    document.body.removeChild(el);
  });
});

describe('component — remount and capture-scope edge cases', () => {
  it('re-mounts an already-rendered instance by moving its node', () => {
    const t1 = container();
    const t2 = container();
    const def: ComponentDefinition = { render: () => createElement('div') };

    const instance = createComponentInstance(def);
    instance.mount(t1);
    const el = instance.el;

    instance.mount(t2); // second mount: moves the existing node
    expect(instance.el).toBe(el);
    expect(t2.firstChild).toBe(el);
    expect(t1.firstChild).toBeNull();

    instance.unmount();
    t1.remove();
    t2.remove();
  });

  it('stopCapturing helpers are safe without a matching start', () => {
    expect(stopCapturingDisposers(null)).toEqual([]);
    expect(stopCapturingLifecycle()).toEqual({ mount: [], destroy: [] });
  });

  it('mount() reports a non-string target as "Element" when missing', () => {
    const def: ComponentDefinition = { render: () => createElement('div') };
    expect(() => mount(def, undefined as unknown as Element)).toThrow(
      '[utopia] Mount target not found: Element',
    );
  });

  it('hydrate() reports a non-string target as "Element" when missing', () => {
    const def: ComponentDefinition = { render: () => createElement('div') };
    expect(() => hydrate(def, undefined as unknown as Element)).toThrow(
      '[utopia] Hydration target not found: Element',
    );
  });
});

describe('directives — branch edge cases', () => {
  it('createIf does not re-render when the condition changes but stays truthy', () => {
    const parent = container();
    const anchor = document.createComment('if');
    parent.appendChild(anchor);

    const count = signal(1);
    let renders = 0;

    createIf(
      anchor,
      () => count(),
      () => {
        renders++;
        return createElement('span');
      },
    );

    const node = parent.querySelector('span');
    expect(renders).toBe(1);

    count.set(2); // still truthy — branch must not be rebuilt
    expect(renders).toBe(1);
    expect(parent.querySelector('span')).toBe(node);
    parent.remove();
  });

  it('createIf tolerates the anchor being detached after the initial render', () => {
    const parent = container();
    const anchor = document.createComment('if');
    parent.appendChild(anchor);

    const cond = signal(true);
    createIf(
      anchor,
      () => cond(),
      () => createElement('span'),
    );
    expect(parent.querySelector('span')).not.toBeNull();

    parent.removeChild(anchor);
    expect(() => cond.set(false)).not.toThrow();
    parent.remove();
  });

  it('createFor renders duplicate primitive values as separate nodes', () => {
    const parent = container();
    const anchor = document.createComment('for');
    parent.appendChild(anchor);

    const items = signal(['a', 'a', 'b']);
    createFor(
      anchor,
      () => items(),
      (item) => {
        const li = createElement('li');
        li.textContent = item;
        return li;
      },
    );

    const lis = parent.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(Array.from(lis).map((l) => l.textContent)).toEqual(['a', 'a', 'b']);
    parent.remove();
  });

  it('createFor reports (not propagates) a renderItem error during an update', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const parent = container();
    const anchor = document.createComment('for');
    parent.appendChild(anchor);

    const items = signal(['ok']);
    createFor(
      anchor,
      () => items(),
      (item) => {
        if (item === 'bad') throw new Error('renderItem failed');
        const li = createElement('li');
        li.textContent = item;
        return li;
      },
    );
    expect(parent.querySelectorAll('li').length).toBe(1);

    // the throwing update is contained by the effect's error handling.
    expect(() => items.set(['ok', 'bad'])).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    // the previously rendered item is still on screen.
    expect(parent.querySelectorAll('li')[0].textContent).toBe('ok');

    errorSpy.mockRestore();
    parent.remove();
  });

  it('createComponent returns a plain Node from a function component directly', () => {
    const el = document.createElement('p');
    el.textContent = 'plain node';
    const node = createComponent((() => el) as unknown as () => ComponentDefinition);
    expect(node).toBe(el);
  });

  it('createIf dispose is idempotent', () => {
    const parent = container();
    const anchor = document.createComment('if');
    parent.appendChild(anchor);

    const show = signal(true);
    const dispose = createIf(
      anchor,
      () => show(),
      () => createElement('span'),
    );
    expect(parent.querySelector('span')).not.toBeNull();

    dispose();
    expect(parent.querySelector('span')).toBeNull();
    expect(() => dispose()).not.toThrow(); // second dispose is a no-op
    parent.remove();
  });

  it('createFor keys objects by their id property when no key callback is given', () => {
    const parent = container();
    const anchor = document.createComment('for');
    parent.appendChild(anchor);

    const items = signal([{ id: 'a' }, { id: 'b' }]);
    createFor(
      anchor,
      () => items(),
      (item) => {
        const li = createElement('li');
        li.textContent = String(item.id);
        return li;
      },
      // no key callback — must fall back to the id property
    );

    const [a, b] = Array.from(parent.querySelectorAll('li'));
    // new array, new object references, same ids → nodes reused (reordered).
    items.set([{ id: 'b' }, { id: 'a' }]);
    const after = Array.from(parent.querySelectorAll('li'));
    expect(after[0]).toBe(b);
    expect(after[1]).toBe(a);
    parent.remove();
  });

  it('createFor tolerates externally-removed nodes on update and dispose', () => {
    const parent = container();
    const anchor = document.createComment('for');
    parent.appendChild(anchor);

    const items = signal(['a', 'b', 'c']);
    const dispose = createFor(
      anchor,
      () => items(),
      (item) => {
        const li = createElement('li');
        li.textContent = item;
        return li;
      },
    );

    // something outside the runtime removes a node (e.g. an extension).
    const bNode = Array.from(parent.querySelectorAll('li')).find((l) => l.textContent === 'b')!;
    parent.removeChild(bNode);

    // dropping the externally-removed entry must not throw.
    expect(() => items.set(['a', 'c'])).not.toThrow();

    // remove another node externally, then dispose the whole list.
    const cNode = Array.from(parent.querySelectorAll('li')).find((l) => l.textContent === 'c')!;
    parent.removeChild(cNode);
    expect(() => dispose()).not.toThrow();
    expect(parent.querySelectorAll('li').length).toBe(0);
    parent.remove();
  });

  it('a component cleanup is idempotent', () => {
    let destroyed = 0;
    const def: ComponentDefinition = {
      setup() {
        onDestroy(() => destroyed++);
        return {};
      },
      render: () => createElement('div'),
    };
    const node = createComponent(def) as unknown as { __cleanup: () => void };
    node.__cleanup();
    node.__cleanup();
    expect(destroyed).toBe(1);
  });
});

describe('DOM — setHtml / setAttr branch coverage', () => {
  it('setHtml reactively updates innerHTML and stops on unmount', () => {
    const s = signal<string | null>('<b>a</b>');
    const def: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        setHtml(el, () => s());
        return el;
      },
    };

    const instance = createComponentInstance(def);
    instance.mount(document.body);
    const el = instance.el as HTMLElement;
    expect(el.innerHTML).toBe('<b>a</b>');

    flushSync(() => s.set('<i>b</i>'));
    expect(el.innerHTML).toBe('<i>b</i>');

    flushSync(() => s.set(null)); // null → empty string
    expect(el.innerHTML).toBe('');

    instance.unmount();
    flushSync(() => s.set('<u>leak?</u>'));
    expect(el.innerHTML).toBe(''); // effect disposed
  });

  it('setHtml skips the DOM write when a re-run produces identical html', () => {
    const tick = signal(0);
    const def: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        setHtml(el, () => {
          tick(); // tracked, output constant
          return '<b>fixed</b>';
        });
        return el;
      },
    };
    const instance = createComponentInstance(def);
    instance.mount(document.body);
    const el = instance.el as HTMLElement;
    expect(el.innerHTML).toBe('<b>fixed</b>');
    tick.set(1); // re-run — innerHTML equality guard skips the write
    expect(el.innerHTML).toBe('<b>fixed</b>');
    instance.unmount();
  });

  it('setSafeHtml renders an empty string for a null value', () => {
    const s = signal<string | null>('<b>x</b>');
    const def: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        setSafeHtml(el, () => s());
        return el;
      },
    };
    const instance = createComponentInstance(def);
    instance.mount(document.body);
    const el = instance.el as HTMLElement;
    expect(el.innerHTML).toBe('<b>x</b>');
    flushSync(() => s.set(null));
    expect(el.innerHTML).toBe('');
    instance.unmount();
  });

  it('setSafeHtml keeps the DOM stable when a re-run produces identical input', () => {
    const tick = signal(0);
    const def: ComponentDefinition = {
      render() {
        const el = document.createElement('div');
        setSafeHtml(el, () => {
          tick(); // tracked, but output is constant
          return '<b>same</b>';
        });
        return el;
      },
    };

    const instance = createComponentInstance(def);
    instance.mount(document.body);
    const el = instance.el as HTMLElement;
    expect(el.innerHTML).toBe('<b>same</b>');

    tick.set(1); // re-run with identical raw input → memoised, DOM unchanged
    expect(el.innerHTML).toBe('<b>same</b>');
    instance.unmount();
  });

  it('creates SVG elements in the SVG namespace and sets class via setAttribute', () => {
    const svg = createElement('svg');
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');

    setAttr(svg, 'class', 'icon');
    expect(svg.getAttribute('class')).toBe('icon');

    setAttr(svg, 'class', { active: true, hidden: false });
    expect(svg.getAttribute('class')).toBe('active');
  });

  it('removes class and style attributes when bound to false', () => {
    const el = createElement('div') as HTMLElement;
    el.className = 'x';
    setAttr(el, 'class', false);
    expect(el.hasAttribute('class')).toBe(false);

    el.style.cssText = 'color: red';
    setAttr(el, 'style', false);
    expect(el.hasAttribute('style')).toBe(false);
  });

  it('sets a boolean attribute that has no matching IDL property', () => {
    const el = createElement('div');
    setAttr(el, 'novalidate', true);
    expect(el.hasAttribute('novalidate')).toBe(true);
    setAttr(el, 'novalidate', false);
    expect(el.hasAttribute('novalidate')).toBe(false);
  });

  it('skips null style-object values and supports kebab-case properties', () => {
    const el = createElement('div') as HTMLElement;
    setAttr(el, 'style', { color: 'red', 'font-size': '10px', opacity: null });
    expect(el.style.color).toBe('red');
    expect(el.style.fontSize).toBe('10px');
    expect(el.style.opacity).toBe('');
  });
});

describe('Hydration — mismatch recovery', () => {
  let target: HTMLElement;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    target = container();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    target.remove();
  });

  it('replaces a non-element node when an element was expected', () => {
    target.innerHTML = '';
    target.appendChild(document.createTextNode('server text'));

    const def: ComponentDefinition = { render: () => createElement('div') };
    const instance = hydrate(def, target);

    expect(warnSpy).toHaveBeenCalled();
    expect((instance.el as Element).tagName).toBe('DIV');
    expect(target.firstChild).toBe(instance.el); // swapped in place
    expect(target.textContent).toBe(''); // the stale text node is gone
    instance.unmount();
  });

  it('replaces an element when a text node was expected', () => {
    target.innerHTML = '<span>x</span>';

    const def: ComponentDefinition = { render: () => createTextNode('hi') };
    const instance = hydrate(def, target);

    expect(warnSpy).toHaveBeenCalled();
    expect(target.firstChild!.nodeType).toBe(3);
    expect(target.firstChild!.textContent).toBe('hi');
    expect(target.querySelector('span')).toBeNull();
    instance.unmount();
  });

  it('replaces an element when a comment node was expected', () => {
    target.innerHTML = '<span>x</span>';

    const def: ComponentDefinition = { render: () => createComment('marker') };
    const instance = hydrate(def, target);

    expect(warnSpy).toHaveBeenCalled();
    expect(target.firstChild!.nodeType).toBe(8);
    expect((target.firstChild as Comment).data).toBe('marker');
    instance.unmount();
  });

  it('creates a fresh node when the server DOM has nothing left to claim', () => {
    target.innerHTML = ''; // nothing to claim

    const def: ComponentDefinition = { render: () => createElement('div') };
    const instance = hydrate(def, target);

    expect(warnSpy).toHaveBeenCalled();
    expect((instance.el as Element).tagName).toBe('DIV');
    instance.unmount();
  });
});

describe('select value before options mount', () => {
  it('re-applies the bound value once options exist', async () => {
    const raf = (cb) => setTimeout(cb, 0);
    const orig = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = raf;
    try {
      const sel = document.createElement('select');
      document.body.appendChild(sel);
      setAttr(sel, 'value', 'b');
      // no options yet - the browser cannot hold the value.
      for (const v of ['a', 'b']) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
      }
      await new Promise((r) => setTimeout(r, 1));
      expect(sel.value).toBe('b');
      sel.remove();

      // second scenario: the value settles BEFORE the retry frame runs —
      // the retry must leave the (already-correct) selection alone.
      const sel2 = document.createElement('select');
      document.body.appendChild(sel2);
      setAttr(sel2, 'value', 'x'); // queues a retry (no options yet)
      for (const v of ['w', 'x']) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        sel2.appendChild(o);
      }
      sel2.value = 'x'; // already correct before the frame fires
      await new Promise((r) => setTimeout(r, 1));
      expect(sel2.value).toBe('x');
      sel2.remove();
    } finally {
      globalThis.requestAnimationFrame = orig;
    }
  });
});
