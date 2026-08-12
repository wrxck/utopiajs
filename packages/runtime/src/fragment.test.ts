/**
 * Tests for fragment-rooted subtrees: creation, insertion bookkeeping,
 * reclaim-on-remove, re-mount, and integration with createIf branch
 * teardown — the paths a multi-root component exercises when the compiler's
 * `fragments` option is on.
 */

import { signal } from '@matthesketh/utopia-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createComponentInstance, pushDisposer } from '@/component';
import { createFor, createIf } from '@/directives';
import { appendChild, createElement, createFragment, insertBefore, removeNode } from '@/dom';

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  document.body.innerHTML = '';
});

function makeFragment(labels: string[]): DocumentFragment {
  return createFragment(
    labels.map((l) => {
      const el = createElement('span');
      el.textContent = l;
      return el;
    }),
  );
}

describe('createFragment', () => {
  it('holds the given nodes in order', () => {
    const frag = makeFragment(['a', 'b']);
    expect(frag.childNodes).toHaveLength(2);
    expect(frag.textContent).toBe('ab');
  });

  it('distributes children into the parent on appendChild', () => {
    const frag = makeFragment(['a', 'b']);
    appendChild(host, frag);
    expect(host.childNodes).toHaveLength(2);
    expect(host.textContent).toBe('ab');
    expect(frag.childNodes).toHaveLength(0);
  });

  it('removeNode reclaims a previously inserted fragment', () => {
    const frag = makeFragment(['a', 'b']);
    appendChild(host, frag);
    expect(host.childNodes).toHaveLength(2);

    removeNode(frag);
    expect(host.childNodes).toHaveLength(0);
    // reclaimed — the fragment holds its roots again and can re-mount
    expect(frag.childNodes).toHaveLength(2);

    appendChild(host, frag);
    expect(host.textContent).toBe('ab');
  });

  it('reclaim keeps sibling content outside the fragment intact', () => {
    const before = createElement('p');
    before.textContent = 'before';
    host.appendChild(before);

    const frag = makeFragment(['x', 'y']);
    const after = createElement('p');
    after.textContent = 'after';
    host.appendChild(after);
    insertBefore(host, frag, after);
    expect(host.textContent).toBe('beforexyafter');

    removeNode(frag);
    expect(host.textContent).toBe('beforeafter');
  });

  it('removeNode on a never-inserted fragment is a no-op', () => {
    const frag = makeFragment(['a']);
    expect(() => removeNode(frag)).not.toThrow();
    expect(frag.childNodes).toHaveLength(1);
  });

  it('records the roots of a nested fragment before draining it', () => {
    // a multi-root child component inside multi-child slot content: the inner
    // fragment is a member of the outer createFragment call and must get its
    // __roots recorded before the outer fragment drains it.
    const inner = makeFragment(['in1', 'in2']);
    const p = createElement('p');
    p.textContent = 'sibling';
    const outer = createFragment([inner, p]);

    appendChild(host, outer);
    expect(host.textContent).toBe('in1in2sibling');

    // detaching the inner fragment must remove ITS nodes, not believe the
    // subtree was already gone.
    removeNode(inner);
    expect(host.textContent).toBe('sibling');
    expect(inner.childNodes).toHaveLength(2);
  });
});

describe('fragment-rooted component instances', () => {
  it('unmount detaches a fragment root and a re-mount moves it', () => {
    const definition = {
      render: () => makeFragment(['r1', 'r2']),
    };

    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.appendChild(a);
    document.body.appendChild(b);

    const instance = createComponentInstance(definition);
    instance.mount(a);
    expect(a.textContent).toBe('r1r2');

    // the documented "already rendered — just move" path
    instance.mount(b);
    expect(a.textContent).toBe('');
    expect(b.textContent).toBe('r1r2');

    instance.unmount();
    expect(b.textContent).toBe('');
  });
});

describe('fragment-rooted rows in createFor', () => {
  const rowFactory =
    () =>
    (item: { id: string }): Node =>
      makeFragment([`${item.id}1`, `${item.id}2`]);

  it('renders, reorders and removes multi-node rows', () => {
    const anchor = document.createComment('for');
    host.appendChild(anchor);
    const items = signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    createFor(
      anchor,
      () => items(),
      rowFactory(),
      (item) => item.id,
    );
    expect(host.textContent).toBe('a1a2b1b2c1c2');

    // tail → head move
    items.set([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
    expect(host.textContent).toBe('c1c2a1a2b1b2');

    // removal detaches the row's whole range
    items.set([{ id: 'c' }, { id: 'b' }]);
    expect(host.textContent).toBe('c1c2b1b2');

    items.set([]);
    expect(host.textContent).toBe('');
  });

  it('mixes fragment rows with element rows', () => {
    const anchor = document.createComment('for');
    host.appendChild(anchor);
    const items = signal(['frag:a', 'el:b', 'frag:c']);

    createFor(
      anchor,
      () => items(),
      (item) => {
        const [kind, id] = item.split(':');
        if (kind === 'frag') return makeFragment([`${id}1`, `${id}2`]);
        const el = createElement('span');
        el.textContent = id;
        return el;
      },
    );
    expect(host.textContent).toBe('a1a2bc1c2');

    items.set(['el:b', 'frag:c', 'frag:a']);
    expect(host.textContent).toBe('bc1c2a1a2');
  });

  it('evicts and disposes fresh rows when a later renderItem throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const anchor = document.createComment('for');
    host.appendChild(anchor);
    const disposed: string[] = [];
    const items = signal(['a']);

    createFor(
      anchor,
      () => items(),
      (item) => {
        if (item === 'boom') throw new Error('renderItem failed');
        pushDisposer(() => disposed.push(item));
        const li = createElement('li');
        li.textContent = item;
        return li;
      },
    );
    expect(host.querySelectorAll('li')).toHaveLength(1);

    // 'b' is created fresh, then 'boom' throws — 'b' must be evicted from the
    // persistent key map and its captured disposers run.
    expect(() => items.set(['a', 'b', 'boom'])).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    expect(disposed).toContain('b');

    // a later successful pass renders cleanly — no stale never-inserted reuse
    items.set(['a', 'b']);
    const lis = Array.from(host.querySelectorAll('li'));
    expect(lis.map((li) => li.textContent)).toEqual(['a', 'b']);

    errorSpy.mockRestore();
  });
});

describe('fragment roots inside createIf', () => {
  it('toggling a branch that renders a fragment adds and removes all roots', () => {
    const anchor = document.createComment('if');
    host.appendChild(anchor);
    const show = signal(true);

    createIf(
      anchor,
      () => show(),
      () => {
        const frag = makeFragment(['one', 'two']);
        return frag;
      },
    );

    expect(host.textContent).toBe('onetwo');

    show.set(false);
    expect(host.textContent).toBe('');

    show.set(true);
    expect(host.textContent).toBe('onetwo');
  });

  it('anchors inside a fragment resolve their parent after mounting', async () => {
    // a nested createIf whose anchor lives inside the fragment: before the
    // fragment is inserted the anchor's parent is the fragment itself, after
    // insertion it is the host — the branch must follow along.
    const inner = signal(true);
    const anchor = document.createComment('nested');
    const frag = createFragment([anchor]);

    createIf(
      anchor,
      () => inner(),
      () => {
        const el = createElement('em');
        el.textContent = 'nested';
        return el;
      },
    );

    appendChild(host, frag);
    // the first applyBranch may have run against the fragment; a microtask
    // retry settles it into the live DOM.
    await Promise.resolve();
    expect(host.textContent).toBe('nested');

    inner.set(false);
    expect(host.textContent).toBe('');
  });
});
