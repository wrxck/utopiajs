// ============================================================================
// @matthesketh/utopia-server — renderToStream tests
// ============================================================================

import { describe, it, expect } from 'vitest';
import type { Readable } from 'node:stream';
import type { VElement } from './vnode';
import {
  createElement,
  createTextNode,
  createComment,
  appendChild,
  setAttr,
  useHead,
  flushHead,
} from './ssr-runtime';
import { renderToString } from './render-to-string';
import { renderToStream } from './render-to-stream';

async function readAll(stream: Readable): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }
  return chunks.join('');
}

describe('renderToStream', () => {
  it('streams a nested tree with attributes, text, comments and void elements', async () => {
    const Component = {
      render: () => {
        const div = createElement('div');
        setAttr(div, 'class', 'wrap');
        setAttr(div, 'hidden', true); // boolean attr → empty string value
        const img = createElement('img');
        setAttr(img, 'src', 'https://example.com/a.png');
        appendChild(div, img);
        appendChild(div, createComment('marker'));
        const p = createElement('p');
        appendChild(p, createTextNode('Tom & "Jerry" <3'));
        appendChild(div, p);
        return div;
      },
    };

    const output = await readAll(renderToStream(Component));
    expect(output).toBe(
      '<div class="wrap" hidden>' +
        '<img src="https://example.com/a.png">' +
        '<!--marker-->' +
        '<p>Tom &amp; "Jerry" &lt;3</p>' +
        '</div>',
    );
  });

  it('produces the same markup as renderToString for the same component', async () => {
    const Component = {
      setup: (props: Record<string, unknown>) => ({ items: props.items ?? [] }),
      render: (ctx: Record<string, unknown>) => {
        const ul = createElement('ul');
        for (const item of ctx.items as string[]) {
          const li = createElement('li');
          appendChild(li, createTextNode(item));
          appendChild(ul, li);
        }
        return ul;
      },
    };
    const props = { items: ['a', 'b & c'] };

    const streamed = await readAll(renderToStream(Component, props));
    const { html } = renderToString(Component, props);
    expect(streamed).toBe(html);
  });

  it('emits collected styles as a leading <style> block', async () => {
    const Component = {
      render: () => createElement('div'),
      styles: '.a { color: red; }',
    };
    const output = await readAll(renderToStream(Component));
    expect(output.startsWith('<style>.a { color: red; }</style>')).toBe(true);
  });

  it('emits no <style> block when the component has no styles', async () => {
    const Component = { render: () => createElement('div') };
    const output = await readAll(renderToStream(Component));
    expect(output).toBe('<div></div>');
  });

  it('does not leak styles from a previous render into the stream', async () => {
    const Styled = { render: () => createElement('div'), styles: '.stale { color: red; }' };
    const Plain = { render: () => createElement('span') };

    // Render the styled component but never flush; the next stream must not
    // pick up the stale styles.
    await readAll(renderToStream(Styled));
    const output = await readAll(renderToStream(Plain));
    expect(output).toBe('<span></span>');
  });

  it('discards head entries collected during a streamed render', async () => {
    const Component = {
      setup: () => {
        useHead({ title: 'Streamed Page' });
        return {};
      },
      render: () => createElement('div'),
    };

    await readAll(renderToStream(Component));
    // A stream has no head-injection point, so entries collected during the
    // render must not linger in module state and pollute a later render.
    expect(flushHead()).toEqual([]);
  });

  it('emits an error (not a crash) when the tree exceeds the depth limit', async () => {
    const Component = {
      render: () => {
        const root = createElement('div');
        let current = root;
        for (let i = 0; i < 1001; i++) {
          const child = createElement('div');
          appendChild(current, child);
          current = child;
        }
        return root;
      },
    };

    await expect(readAll(renderToStream(Component))).rejects.toThrow(/maximum depth/);
  });

  it('emits an error for an invalid tag name', async () => {
    const Component = {
      render: () => createElement('div><script>alert(1)</script'),
    };
    await expect(readAll(renderToStream(Component))).rejects.toThrow(/Invalid tag name/);
  });

  it('emits an error for an invalid attribute name', async () => {
    const Component = {
      render: () => {
        const el = createElement('div');
        // Bypass setAttr validation to simulate a hostile VNode tree.
        (el as VElement).attrs['x" onmouseover="alert(1)'] = 'y';
        return el;
      },
    };
    await expect(readAll(renderToStream(Component))).rejects.toThrow(/Invalid attribute name/);
  });

  it('streams output larger than the highWaterMark across multiple reads', async () => {
    const items = Array.from({ length: 3000 }, (_, i) => `item-${i}`);
    const Component = {
      render: () => {
        const ul = createElement('ul');
        for (const item of items) {
          const li = createElement('li');
          appendChild(li, createTextNode(item));
          appendChild(ul, li);
        }
        return ul;
      },
    };
    const output = await readAll(renderToStream(Component));
    expect(output.startsWith('<ul><li>item-0</li>')).toBe(true);
    expect(output.endsWith('<li>item-2999</li></ul>')).toBe(true);
    expect(output.length).toBeGreaterThan(16 * 1024);
  });

  it('pauses chunk generation under backpressure instead of buffering everything', async () => {
    const items = Array.from({ length: 10000 }, (_, i) => `item-${i}-padding-padding`);
    const Component = {
      render: () => {
        const ul = createElement('ul');
        for (const item of items) {
          const li = createElement('li');
          appendChild(li, createTextNode(item));
          appendChild(ul, li);
        }
        return ul;
      },
    };

    const stream = renderToStream(Component);
    // Trigger a single fill without consuming anything.
    stream.read(0);
    const buffered = stream.readableLength;
    const highWaterMark = stream.readableHighWaterMark;
    expect(buffered).toBeGreaterThan(0);
    // Generation must stop once the buffer crosses the highWaterMark, well
    // short of the full document (~300KB).
    expect(buffered).toBeLessThan(highWaterMark + 1024);

    const output = await readAll(stream);
    expect(output.length).toBeGreaterThan(buffered);
    expect(output.endsWith('</ul>')).toBe(true);
  });

  it('streams comment-only and text-only roots', async () => {
    expect(await readAll(renderToStream({ render: () => createComment('only -- comment') }))).toBe(
      '<!--only -\u200B- comment-->',
    );
    expect(await readAll(renderToStream({ render: () => createTextNode('<plain>') }))).toBe(
      '&lt;plain&gt;',
    );
  });
});
