/**
 * End-to-end cover for the reactive u-for loop variable.
 *
 * The compiler and the runtime each hold one half of the contract — the row
 * scope the codegen consumes and the version cell createFor bumps — so both
 * halves are exercised here against real compiler output, in a real DOM, and
 * on the SSR path. This package is the one that already depends on both.
 *
 * The bug this locks down: `:key` deliberately reuses a row across a list
 * update, and since keys are usually `item.id`, the canonical immutable
 * update `items.map(x => ({ ...x, name }))` hits that reuse path with a new
 * object under the same key. A row whose bindings closed over the first
 * object rendered it forever. The requirement is row reused, bindings
 * updated, DOM state preserved — all three at once.
 */

import { compileTemplate } from '@matthesketh/utopia-compiler';
import { signal } from '@matthesketh/utopia-core';
import * as runtime from '@matthesketh/utopia-runtime';
// test-only reach across the workspace: the SSR half of the contract lives in
// the server package, and the point of the parity block below is that ONE
// compiled module drives both runtimes.
import { renderToString } from '@matthesketh/utopia-server';
import * as ssrRuntime from '@matthesketh/utopia-server/ssr-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Harness — compile a template and run the emitted module for real
// ---------------------------------------------------------------------------

type RenderFn = (ctx: unknown) => Node;

/**
 * Compile `template` and evaluate the emitted ES module, feeding it the real
 * runtime helpers and the template's free variables. This is deliberately the
 * genuine compiler output rather than a hand-written stand-in: the point is to
 * catch the two halves drifting apart.
 */
function build(
  template: string,
  freeVars: Record<string, unknown>,
  helpers: Record<string, unknown> = runtime as unknown as Record<string, unknown>,
): RenderFn {
  const { code } = compileTemplate(template);
  const body = code.replace(/^import[^\n]*\n/, '');
  const helperNames = Object.keys(helpers);
  const varNames = Object.keys(freeVars);
  const factory = new Function(...helperNames, ...varNames, `${body}\nreturn __render`) as (
    ...args: unknown[]
  ) => RenderFn;
  return factory(...helperNames.map((n) => helpers[n]), ...varNames.map((n) => freeVars[n]));
}

/**
 * The same compiled module, wired to the SSR runtime instead — the swap a
 * real build performs with a Vite alias.
 */
function buildServer(
  template: string,
  freeVars: Record<string, unknown>,
): Parameters<typeof renderToString>[0] {
  const render = build(template, freeVars, ssrRuntime as unknown as Record<string, unknown>);
  return { render } as unknown as Parameters<typeof renderToString>[0];
}

let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

describe('u-for loop variable is reactive', () => {
  it('updates a reused row instead of rendering the item it was born with', async () => {
    const items = signal([
      { id: 'a', name: 'alpha' },
      { id: 'b', name: 'beta' },
    ]);
    host.appendChild(
      build('<ul><li u-for="item in items()" :key="item.id">{{ item.name }}</li></ul>', {
        items,
      })({}),
    );
    const rowA = host.querySelector('li') as HTMLElement;
    expect(host.textContent).toBe('alphabeta');

    // the canonical immutable update: same keys, new objects.
    items.set([
      { id: 'a', name: 'alpha-2' },
      { id: 'b', name: 'beta-2' },
    ]);

    await runtime.nextTick();
    expect(host.textContent).toBe('alpha-2beta-2');
    // reused, not rebuilt — that is what :key is for.
    expect(host.querySelector('li')).toBe(rowA);
  });

  it('refreshes (item, index) after a reorder that reuses every node', async () => {
    const a = { id: 'a', name: 'alpha' };
    const b = { id: 'b', name: 'beta' };
    const c = { id: 'c', name: 'gamma' };
    const items = signal([a, b, c]);
    host.appendChild(
      build(
        '<ul><li u-for="(item, i) in items()" :key="item.id">{{ i }}:{{ item.name }}</li></ul>',
        {
          items,
        },
      )({}),
    );
    const rowA = host.querySelector('li') as HTMLElement;
    expect(host.textContent).toBe('0:alpha1:beta2:gamma');

    // same object references, new order — every node is moved, none rebuilt.
    items.set([c, a, b]);

    await runtime.nextTick();
    expect(host.textContent).toBe('0:gamma1:alpha2:beta');
    expect(host.querySelectorAll('li')[1]).toBe(rowA);
  });

  it('keeps focus and caret in a row whose siblings update around it', async () => {
    // the case the whole fix exists for: an editable row in a list that is
    // rebuilt immutably on every keystroke. re-creating the row would blur
    // the input mid-word; leaving it stale would show the wrong number.
    const items = signal([
      { id: 'a', grams: '100' },
      { id: 'b', grams: '20' },
    ]);
    host.appendChild(
      build('<ul><li u-for="row in items()" :key="row.id"><input :value="row.grams" /></li></ul>', {
        items,
      })({}),
    );

    const first = host.querySelectorAll('input')[0] as HTMLInputElement;
    first.focus();
    first.setSelectionRange(2, 2);
    expect(document.activeElement).toBe(first);

    items.set([
      { id: 'a', grams: '100' },
      { id: 'b', grams: '25' },
    ]);

    // identity, focus and caret survive the reconcile immediately (structural
    // work is synchronous); the value binding lands on the microtask.
    expect(host.querySelectorAll('input')[0]).toBe(first);
    expect(document.activeElement).toBe(first);
    expect(first.selectionStart).toBe(2);
    await runtime.nextTick();
    expect(document.activeElement).toBe(first);
    expect(first.selectionStart).toBe(2);
    expect((host.querySelectorAll('input')[1] as HTMLInputElement).value).toBe('25');
  });

  it('reconciles a nested list against a reused outer row', async () => {
    const groups = signal([{ id: 'g1', label: 'G1', children: [{ id: 'c1', name: 'one' }] }]);
    host.appendChild(
      build(
        '<ul><li u-for="group in groups()" :key="group.id">{{ group.label }}<span u-for="child in group.children" :key="child.id">{{ child.name }}</span></li></ul>',
        { groups },
      )({}),
    );
    const row = host.querySelector('li') as HTMLElement;
    expect(host.textContent).toBe('G1one');

    groups.set([
      {
        id: 'g1',
        label: 'G1!',
        children: [
          { id: 'c1', name: 'one' },
          { id: 'c2', name: 'two' },
        ],
      },
    ]);

    await runtime.nextTick();
    expect(host.textContent).toBe('G1!onetwo');
    expect(host.querySelector('li')).toBe(row);
  });

  it('gives an event handler the item the row currently shows', () => {
    // a handler that fires on the record the user is no longer looking at is
    // a data-correctness bug, not a cosmetic one — deleting row 3 must delete
    // what row 3 displays now.
    const removed: string[] = [];
    const remove = (item: { id: string; name: string }): void => {
      removed.push(item.name);
    };
    const items = signal([{ id: 'a', name: 'alpha' }]);
    host.appendChild(
      build(
        '<ul><li u-for="item in items()" :key="item.id" @click="() => remove(item)">{{ item.name }}</li></ul>',
        { items, remove },
      )({}),
    );

    (host.querySelector('li') as HTMLElement).click();
    items.set([{ id: 'a', name: 'renamed' }]);
    (host.querySelector('li') as HTMLElement).click();

    expect(removed).toEqual(['alpha', 'renamed']);
  });

  it('re-evaluates a kept row when the item was mutated in place', async () => {
    // the row cannot tell a mutation from a replacement, so a list update
    // always re-runs the bindings of the rows it kept.
    const item = { id: 'a', name: 'alpha' };
    const items = signal([item]);
    host.appendChild(
      build('<ul><li u-for="it in items()" :key="it.id">{{ it.name }}</li></ul>', { items })({}),
    );

    item.name = 'mutated';
    items.set([item]);

    await runtime.nextTick();
    expect(host.textContent).toBe('mutated');
  });

  it('leaves a removed row disposed rather than refreshing it', async () => {
    let runs = 0;
    const probe = (value: string): string => {
      runs++;
      return value;
    };
    const items = signal([
      { id: 'a', name: 'alpha' },
      { id: 'b', name: 'beta' },
    ]);
    host.appendChild(
      build('<ul><li u-for="it in items()" :key="it.id">{{ probe(it.name) }}</li></ul>', {
        items,
        probe,
      })({}),
    );
    expect(runs).toBe(2);

    // 'b' goes away; only the surviving row re-evaluates.
    items.set([{ id: 'a', name: 'alpha' }]);
    await runtime.nextTick();
    expect(runs).toBe(3);
    items.set([{ id: 'a', name: 'alpha-2' }]);
    await runtime.nextTick();
    expect(runs).toBe(4);
    expect(host.textContent).toBe('alpha-2');
  });
});

// ---------------------------------------------------------------------------
// Server + hydration
// ---------------------------------------------------------------------------

describe('u-for row scope on the SSR and hydration paths', () => {
  const TEMPLATE = '<ul><li u-for="item in items()" :key="item.id">{{ item.name }}</li></ul>';

  const rows = (): { id: string; name: string }[] => [
    { id: 'a', name: 'alpha' },
    { id: 'b', name: 'beta' },
  ];

  it('server-renders exactly what a first client render produces', () => {
    // a server render is a single pass: no row is ever reused, so its scope
    // is inert and the rows evaluate the same expressions against the same
    // items. the two runtimes must agree byte for byte or hydration has
    // nothing to attach to.
    const serverHtml = renderToString(buildServer(TEMPLATE, { items: signal(rows()) })).html;

    host.appendChild(build(TEMPLATE, { items: signal(rows()) })({}));

    expect(serverHtml).toBe('<ul><li>alpha</li><li>beta</li><!--u-for--></ul>');
    expect(host.innerHTML).toBe(serverHtml);
  });

  it('hydrates onto the server nodes and leaves the rows live', async () => {
    const items = signal(rows());
    const serverHtml = renderToString(buildServer(TEMPLATE, { items: signal(rows()) })).html;

    host.innerHTML = serverHtml;
    const serverRow = host.querySelector('li') as HTMLElement;
    const serverText = serverRow.firstChild;

    runtime.hydrate({ render: build(TEMPLATE, { items }) }, host);

    // the walker claimed the server's own nodes rather than building new
    // ones. (u-for hydration is only partial today — the server emits the
    // list anchor after the rows while the client creates it first — but the
    // row scope adds no nodes, so the claim sequence is untouched.)
    expect(host.querySelector('li')).toBe(serverRow);
    expect(serverRow.firstChild).toBe(serverText);

    // and the claimed row is reactive: an immutable update reaches it.
    items.set([
      { id: 'a', name: 'alpha-2' },
      { id: 'b', name: 'beta' },
    ]);
    await runtime.nextTick();
    expect(serverRow.textContent).toBe('alpha-2');
    expect(host.querySelector('li')).toBe(serverRow);
  });
});
