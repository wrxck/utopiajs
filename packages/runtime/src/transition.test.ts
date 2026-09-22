/**
 * `u-transition` on `u-if` branches and `u-for` rows.
 *
 * The compiled directive calls createTransition(el, opts) and discards the
 * result, so for a long time the directive did nothing at all: nothing ever
 * called the hooks. The structural directives now find them on the element.
 */

import { signal } from '@matthesketh/utopia-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFor, createIf } from '@/directives';
import { createTransition } from '@/transition';

let parent: HTMLElement;
let anchor: Comment;

beforeEach(() => {
  vi.useFakeTimers();
  parent = document.createElement('div');
  anchor = document.createComment('u-if');
  parent.appendChild(anchor);
  document.body.appendChild(parent);
});

afterEach(() => {
  vi.useRealTimers();
  parent.remove();
});

/** A branch root with `u-transition="fade"`, as the compiler builds it. */
function faded(tag: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  createTransition(el, { name: 'fade' });
  return el;
}

describe('u-transition on a u-if branch', () => {
  it('does not animate the initial render', () => {
    const show = signal(true);
    createIf(
      anchor,
      () => show(),
      () => faded('p', 'x'),
    );
    expect(parent.querySelector('p')!.className).toBe('');
  });

  it('plays enter when the branch appears and leave before it is removed', () => {
    const show = signal(false);
    createIf(
      anchor,
      () => show(),
      () => faded('p', 'x'),
    );

    show.set(true);
    const p = parent.querySelector('p')!;
    expect(p.classList.contains('fade-enter-active')).toBe(true);
    expect(p.classList.contains('fade-enter-to')).toBe(true);
    p.dispatchEvent(new Event('transitionend'));
    expect(p.className).toBe('');

    show.set(false);
    // still in the document while the leave runs
    expect(p.isConnected).toBe(true);
    expect(p.classList.contains('fade-leave-active')).toBe(true);
    p.dispatchEvent(new Event('transitionend'));
    expect(p.isConnected).toBe(false);
  });

  it('removes a leaving element even when no CSS transition is defined', () => {
    const show = signal(true);
    createIf(
      anchor,
      () => show(),
      () => faded('p', 'x'),
    );
    const p = parent.querySelector('p')!;

    show.set(false);
    // no transitionend will ever fire; the element must not stay forever.
    vi.runAllTimers();
    expect(p.isConnected).toBe(false);
  });
});

describe('u-transition on u-for rows', () => {
  it('plays leave on a removed row and enter on an added one', () => {
    const items = signal(['a', 'b']);
    const listAnchor = document.createComment('u-for');
    parent.appendChild(listAnchor);
    createFor(
      listAnchor,
      () => items(),
      (item) => faded('li', item),
      (item) => item,
    );

    const b = [...parent.querySelectorAll('li')].find((li) => li.textContent === 'b')!;
    expect(b.className).toBe(''); // initial rows do not animate

    items.set(['a', 'c']);
    const c = [...parent.querySelectorAll('li')].find((li) => li.textContent === 'c')!;
    expect(c.classList.contains('fade-enter-active')).toBe(true);
    expect(b.classList.contains('fade-leave-active')).toBe(true);
    expect(b.isConnected).toBe(true);

    vi.runAllTimers();
    expect(b.isConnected).toBe(false);
    expect([...parent.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'c']);
  });
});
