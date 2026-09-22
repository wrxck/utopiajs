/**
 * Server render → hydrate round trips against real compiler output.
 *
 * The compiler, the SSR runtime, the serializers and the client's hydration
 * walker each hold part of one contract: the client must claim, node for node,
 * the markup the server wrote for the same compiled module. Every case below
 * renders a template on the server, loads the HTML into a DOM, hydrates it
 * with the client runtime, and then checks that the page is the one a client
 * render would have produced — and that it is live.
 *
 * Before this contract was pinned down, every one of these failed: adjacent
 * text merged into one node, an empty interpolation claimed its neighbour,
 * and u-if / u-for anchors were claimed before the branch or rows they follow.
 */

import { compileTemplate } from '@matthesketh/utopia-compiler';
import { signal } from '@matthesketh/utopia-core';
import * as runtime from '@matthesketh/utopia-runtime';
import { renderToString } from '@matthesketh/utopia-server';
import * as ssrRuntime from '@matthesketh/utopia-server/ssr-runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Helpers = Record<string, unknown>;

/** Compile a template and evaluate the emitted module against `helpers`. */
function build(template: string, freeVars: Record<string, unknown>, helpers: Helpers) {
  const { code } = compileTemplate(template);
  const body = code.replace(/^import[^\n]*\n/, '');
  const names = Object.keys(helpers);
  const vars = Object.keys(freeVars);
  const factory = new Function(...names, ...vars, `${body}\nreturn __render`);
  return factory(...names.map((n) => helpers[n]), ...vars.map((n) => freeVars[n])) as (
    ctx: unknown,
  ) => unknown;
}

let host: HTMLElement;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  host.remove();
});

/**
 * Server-render `template` with fresh state from `state()`, hydrate the
 * result with another fresh copy, and return the client's state. Also
 * renders the template client-side into a scratch element for comparison.
 */
async function roundTrip<S extends Record<string, unknown>>(template: string, state: () => S) {
  const serverDef = { render: build(template, state(), ssrRuntime as unknown as Helpers) };
  const { html } = renderToString(serverDef as Parameters<typeof renderToString>[0]);
  host.innerHTML = html;

  const client = state();
  runtime.hydrate(
    {
      render: build(template, client, runtime as unknown as Helpers),
    } as runtime.ComponentDefinition,
    host,
  );

  const fresh = document.createElement('div');
  fresh.appendChild(build(template, state(), runtime as unknown as Helpers)({}) as unknown as Node);
  // a client render finishes an else-if branch or a root-level directive one
  // microtask later, once its anchor is attached.
  await new Promise((r) => setTimeout(r, 0));

  return { html, client, expected: fresh.innerHTML };
}

describe('hydration claims what the server rendered', () => {
  it('keeps static and interpolated text as separate live nodes', async () => {
    const { client, expected } = await roundTrip('<p>Hello {{ name() }}!</p>', () => ({
      name: signal('Matt'),
    }));
    const p = host.querySelector('p')!;
    expect(host.innerHTML).toBe(expected);
    expect(warn).not.toHaveBeenCalled();

    client.name.set('Ada');
    await runtime.nextTick();
    expect(p.textContent).toBe('Hello Ada!');
    expect(host.querySelector('p')).toBe(p);
  });

  it('attaches an interpolation that rendered empty on the server', async () => {
    const { client } = await roundTrip('<p>{{ error() }}</p><span>after</span>', () => ({
      error: signal(''),
    }));
    expect(warn).not.toHaveBeenCalled();

    client.error.set('Boom');
    await runtime.nextTick();
    expect(host.querySelector('p')!.textContent).toBe('Boom');
    expect(host.querySelector('span')!.textContent).toBe('after');
  });

  it('keeps static text after an interpolation that rendered empty', async () => {
    const { client, expected } = await roundTrip('<p>{{ pre() }}Hello {{ name() }}</p>', () => ({
      pre: signal(''),
      name: signal('Ada'),
    }));
    expect(host.innerHTML).toBe(expected);
    expect(host.textContent).toBe('Hello Ada');
    expect(warn).not.toHaveBeenCalled();

    client.pre.set('» ');
    client.name.set('Bo');
    await runtime.nextTick();
    expect(host.textContent).toBe('» Hello Bo');
  });

  it('keeps list rows whose first interpolation is empty', async () => {
    const { expected } = await roundTrip(
      '<ul><li u-for="x in xs()" :key="x.id">{{ x.badge }}Item {{ x.name }}</li></ul>',
      () => ({ xs: signal([{ id: 1, badge: '', name: 'a' }]) }),
    );
    expect(host.innerHTML).toBe(expected);
    expect(host.querySelector('li')!.textContent).toBe('Item a');
  });

  it('rebuilds raw-text element content instead of duplicating it', async () => {
    const { client } = await roundTrip('<textarea>Hi {{ name() }}</textarea>', () => ({
      name: signal('Ada'),
    }));
    const textarea = host.querySelector('textarea')!;
    expect(textarea.value).toBe('Hi Ada');
    client.name.set('Bo');
    await runtime.nextTick();
    expect(textarea.textContent).toBe('Hi Bo');
  });

  it('claims a u-if branch and toggles it afterwards', async () => {
    const { client, expected } = await roundTrip(
      '<div><b u-if="show()">yes</b><i>tail</i></div>',
      () => ({ show: signal(true) }),
    );
    const b = host.querySelector('b');
    expect(host.innerHTML).toBe(expected);
    expect(warn).not.toHaveBeenCalled();

    client.show.set(false);
    await runtime.nextTick();
    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('i')!.textContent).toBe('tail');

    client.show.set(true);
    await runtime.nextTick();
    expect(host.querySelectorAll('b')).toHaveLength(1);
    expect(host.querySelector('b')).not.toBe(b);
  });

  it('claims the branch of a u-if / u-else-if / u-else chain', async () => {
    const template =
      '<div><b u-if="n() === 1">one</b><i u-else-if="n() === 2">two</i><u u-else>many</u></div>';
    const { client, html, expected } = await roundTrip(template, () => ({ n: signal(2) }));
    expect(html).toContain('<i>two</i>'); // the server renders else-if branches
    expect(host.innerHTML).toBe(expected);
    expect(warn).not.toHaveBeenCalled();

    client.n.set(3);
    await runtime.nextTick();
    expect(host.textContent).toBe('many');
    client.n.set(1);
    await runtime.nextTick();
    expect(host.textContent).toBe('one');
  });

  it('claims u-for rows and keeps reconciling them', async () => {
    const { client, expected } = await roundTrip(
      '<ul><li u-for="x in xs()" :key="x">{{ x }}</li></ul>',
      () => ({ xs: signal(['a', 'b']) }),
    );
    const first = host.querySelector('li');
    expect(host.innerHTML).toBe(expected);
    expect(warn).not.toHaveBeenCalled();

    client.xs.set(['a', 'b', 'c']);
    await runtime.nextTick();
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b', 'c']);
    expect(host.querySelector('li')).toBe(first);

    client.xs.set(['c']);
    await runtime.nextTick();
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['c']);
  });

  it('claims a u-for nested in a u-if', async () => {
    const { client, expected } = await roundTrip(
      '<section><ul u-if="open()"><li u-for="x in xs()" :key="x">{{ x }}</li></ul><p>end</p></section>',
      () => ({ open: signal(true), xs: signal([1, 2]) }),
    );
    expect(host.innerHTML).toBe(expected);
    expect(warn).not.toHaveBeenCalled();

    client.xs.set([1, 2, 3]);
    await runtime.nextTick();
    expect(host.querySelectorAll('li')).toHaveLength(3);
  });

  it('claims a template whose root is a u-if', async () => {
    const { client, expected } = await roundTrip('<p u-if="on()">on</p>', () => ({
      on: signal(true),
    }));
    expect(host.innerHTML).toBe(expected);
    expect(warn).not.toHaveBeenCalled();

    client.on.set(false);
    await runtime.nextTick();
    expect(host.querySelector('p')).toBeNull();
  });

  it('repairs a server list that is longer than the client list', async () => {
    const serverDef = {
      render: build(
        '<ul><li u-for="x in xs()" :key="x">{{ x }}</li></ul>',
        { xs: signal(['a', 'b', 'c']) },
        ssrRuntime as unknown as Helpers,
      ),
    };
    host.innerHTML = renderToString(serverDef as Parameters<typeof renderToString>[0]).html;
    const xs = signal(['a']);
    runtime.hydrate(
      {
        render: build(
          '<ul><li u-for="x in xs()" :key="x">{{ x }}</li></ul>',
          { xs },
          runtime as unknown as Helpers,
        ),
      } as runtime.ComponentDefinition,
      host,
    );
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a']);

    xs.set(['a', 'z']);
    await runtime.nextTick();
    expect([...host.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'z']);
  });

  it('replaces an element whose tag does not match instead of adopting it', () => {
    host.innerHTML = '<i>server</i>';
    runtime.hydrate(
      {
        render: build('<b>client</b>', {}, runtime as unknown as Helpers),
      } as runtime.ComponentDefinition,
      host,
    );
    expect(host.innerHTML).toBe('<b>client</b>');
    expect(warn).toHaveBeenCalled();
  });
});

describe('the SSR runtime serves everything compiled output imports', () => {
  it('exports every value the client runtime exports', () => {
    const missing = Object.keys(runtime).filter((name) => !(name in ssrRuntime));
    expect(missing).toEqual([]);
  });

  it.each([
    ['a static class merged with a bound one', '<div class="a" :class="b"></div>', { b: 'c' }],
    ['u-model', '<input u-model="v">', { v: signal('x') }],
    ['u-html', '<div u-html="h"></div>', { h: '<b>x</b>' }],
    ['u-html.raw', '<div u-html.raw="h"></div>', { h: '<b>x</b>' }],
  ])('server-renders %s', (_label, template, vars) => {
    const def = { render: build(template, vars, ssrRuntime as unknown as Helpers) };
    expect(() => renderToString(def as Parameters<typeof renderToString>[0])).not.toThrow();
  });
});

describe('rows whose component root is a u-if', () => {
  it('hydrate in order and keep their place when toggled', async () => {
    // the row is a component whose template root is a u-if: its node in the
    // list is the anchor, and its branch sits before it.
    const rows = () => [
      { id: 'a', on: signal(true) },
      { id: 'b', on: signal(true) },
      { id: 'c', on: signal(true) },
    ];
    const childTemplate = '<li u-if="row.on()">{{ row.id }}</li>';
    const make = (helpers: Helpers, state: { rows: ReturnType<typeof rows> }) => {
      const Child = {
        setup: (props: Record<string, unknown>) => ({ row: props.row }),
        render: (ctx: Record<string, unknown>) =>
          build(childTemplate, { row: ctx.row }, helpers)({}),
      };
      return build(
        '<ul><Child u-for="r in rows" :key="r.id" :row="r" /><li>end</li></ul>',
        {
          Child,
          rows: state.rows,
        },
        helpers,
      );
    };
    const serverState = { rows: rows() };
    const { html } = renderToString({
      render: make(ssrRuntime as unknown as Helpers, serverState),
    } as Parameters<typeof renderToString>[0]);
    host.innerHTML = html;
    const client = { rows: rows() };
    runtime.hydrate(
      { render: make(runtime as unknown as Helpers, client) } as runtime.ComponentDefinition,
      host,
    );
    expect(host.textContent).toBe('abcend');

    client.rows[0]!.on.set(false);
    await runtime.nextTick();
    client.rows[0]!.on.set(true);
    await runtime.nextTick();
    expect(host.textContent).toBe('abcend');
  });
});
