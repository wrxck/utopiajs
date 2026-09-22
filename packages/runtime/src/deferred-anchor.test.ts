/**
 * A u-if / u-for whose anchor is inserted after its first run.
 *
 * The directive can only render once its anchor has a parent. It used to retry
 * on a single microtask and then give up, so a component whose root is a u-if
 * rendered nothing when it was inserted any later — as the router inserts a
 * page after loading its module.
 */

import { signal } from '@matthesketh/utopia-core';
import { describe, expect, it } from 'vitest';

import { createFor, createIf } from '@/directives';
import { appendChild, createComment, createElement } from '@/dom';
import { rangeOf } from '@/pending';

const later = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('a directive whose anchor is inserted late', () => {
  it('renders a u-if branch when the anchor is finally inserted', async () => {
    const anchor = createComment('u-if');
    createIf(
      anchor,
      () => true,
      () => {
        const p = createElement('p');
        p.textContent = 'shown';
        return p;
      },
    );
    await later(); // well past the directive's own retry

    const host = createElement('div');
    appendChild(host, anchor);
    expect(host.textContent).toBe('shown');
  });

  it('reconciles a u-for when the anchor is finally inserted', async () => {
    const anchor = createComment('u-for');
    createFor(
      anchor,
      () => ['a', 'b'],
      (item) => {
        const li = createElement('li');
        li.textContent = item;
        return li;
      },
    );
    await later();

    const host = createElement('ul');
    appendChild(host, anchor);
    expect(host.textContent).toBe('ab');
  });

  it('does not render a directive disposed before its anchor was inserted', async () => {
    const show = signal(true);
    const anchor = createComment('u-if');
    const dispose = createIf(
      anchor,
      () => show(),
      () => createElement('p'),
    );
    dispose();
    await later();

    const host = createElement('div');
    appendChild(host, anchor);
    expect(host.querySelector('p')).toBeNull();
  });
});

describe('an anchor inserted synchronously', () => {
  it('renders its branch exactly once', async () => {
    let renders = 0;
    const anchor = createComment('u-if');
    createIf(
      anchor,
      () => true,
      () => {
        renders++;
        return createElement('p');
      },
    );
    const host = createElement('div');
    appendChild(host, anchor); // before the directive's own microtask retry
    await later();
    expect(renders).toBe(1);
    expect(host.querySelectorAll('p')).toHaveLength(1);
  });
});

describe('directive ranges', () => {
  it('lists each node of nested u-for / u-if rows once', () => {
    const host = createElement('div');
    const list = createComment('u-for');
    appendChild(host, list);
    createFor(
      list,
      () => [1, 2, 3],
      (n) => {
        const inner = createComment('u-if');
        createIf(
          inner,
          () => true,
          () => {
            const p = createElement('p');
            p.textContent = String(n);
            return p;
          },
        );
        return inner;
      },
    );
    const nodes = rangeOf(list)!;
    expect(new Set(nodes).size).toBe(nodes.length);
    expect(nodes).toHaveLength(7); // three <p>, three u-if anchors, the u-for anchor
    // rendered at once, each branch before its own anchor, rows in order
    expect(host.textContent).toBe('123');
    expect(nodes.map((n) => (n.nodeType === 1 ? n.textContent : '|')).join('')).toBe('1|2|3||');
  });
});
