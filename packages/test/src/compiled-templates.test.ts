/**
 * Compiled templates behave as the markup says.
 *
 * Each case compiles a template with the real compiler and runs the output
 * against the real runtime. All of them failed before their fix.
 */

import { compileTemplate } from '@matthesketh/utopia-compiler';
import { signal } from '@matthesketh/utopia-core';
import * as runtime from '@matthesketh/utopia-runtime';
import { describe, expect, it } from 'vitest';

function build(template: string, freeVars: Record<string, unknown> = {}): Element {
  const { code } = compileTemplate(template);
  const body = code.replace(/^import[^\n]*\n/, '');
  const helpers = runtime as unknown as Record<string, unknown>;
  const names = Object.keys(helpers);
  const vars = Object.keys(freeVars);
  const render = new Function(...names, ...vars, `${body}\nreturn __render`)(
    ...names.map((n) => helpers[n]),
    ...vars.map((n) => freeVars[n]),
  ) as (ctx: unknown) => Element;
  return render({});
}

/** A component that renders its default slot inside a <div>. */
const Card = {
  render(ctx: Record<string, unknown>) {
    const div = document.createElement('div');
    const slots = ctx.$slots as Record<string, () => Node>;
    if (slots.default) div.appendChild(slots.default());
    return div;
  },
};

describe('static attributes', () => {
  it('decodes entities like text does', () => {
    const el = build('<a title="Tom &amp; Jerry &#8212; &quot;live&quot;">x</a>');
    expect(el.getAttribute('title')).toBe('Tom & Jerry — "live"');
  });

  it('decodes a static class merged with a bound one', () => {
    const el = build('<p class="a&amp;b" :class="c"></p>', { c: 'd' });
    expect(el.className).toBe('a&b d');
  });

  it('accepts an unquoted value that contains a slash', () => {
    const el = build('<a href=/docs/intro>x</a>');
    expect(el.getAttribute('href')).toBe('/docs/intro');
  });
});

describe('slot content', () => {
  it('pairs u-if / u-else among several children', () => {
    const show = signal(true);
    const el = build('<Card><p u-if="show()">A</p><p u-else>B</p><span>z</span></Card>', {
      Card,
      show,
    });
    expect(el.textContent).toBe('Az');
  });

  it('renders a slot’s fallback content when nothing fills it', () => {
    expect(build('<div><slot>Fallback <b>text</b></slot></div>').textContent).toBe('Fallback text');
    expect(build('<div><slot name="footer"><i>none</i></slot></div>').textContent).toBe('none');
  });
});

describe('event handlers', () => {
  it('calls a method reference on its object', () => {
    class Counter {
      n = 0;
      inc(): void {
        this.n++;
      }
    }
    const counter = new Counter();
    (build('<button @click="counter.inc">+</button>', { counter }) as HTMLElement).click();
    expect(counter.n).toBe(1);
  });

  it('keeps an identifier that merely starts with $event', () => {
    let seen: unknown;
    const $eventName = 'named';
    (
      build('<button @click="record($eventName)">x</button>', {
        $eventName,
        record: (v: unknown) => (seen = v),
      }) as HTMLElement
    ).click();
    expect(seen).toBe('named');
  });
});
