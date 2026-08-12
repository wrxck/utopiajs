/**
 * Tests for VFragment (type 4): the SSR mirror of the client's
 * createFragment. Fragments flatten into the parent at insertion and
 * serialize as bare children when they are the render root.
 */

import { describe, expect, it } from 'vitest';

import { renderToStream } from '@/render-to-stream';
import { renderToString, serializeVNode } from '@/render-to-string';
import {
  appendChild,
  createComment,
  createElement,
  createFor,
  createFragment,
  createIf,
  createTextNode,
  insertBefore,
  setText,
} from '@/ssr-runtime';
import type { VElement } from '@/vnode';

function el(tag: string, text?: string): VElement {
  const node = createElement(tag);
  if (text !== undefined) {
    const t = createTextNode(text);
    setText(t, text);
    appendChild(node, t);
  }
  return node;
}

describe('createFragment (SSR)', () => {
  it('flattens into the parent on appendChild and empties itself', () => {
    const parent = createElement('main');
    const frag = createFragment([el('header', 'top'), el('footer', 'bottom')]);
    appendChild(parent, frag);

    expect(parent.children).toHaveLength(2);
    expect(frag.children).toHaveLength(0);
    expect(serializeVNode(parent)).toBe('<main><header>top</header><footer>bottom</footer></main>');
  });

  it('flattens before the anchor on insertBefore', () => {
    const parent = createElement('main');
    const anchor = el('nav', 'end');
    appendChild(parent, anchor);

    const frag = createFragment([el('p', 'a'), el('p', 'b')]);
    insertBefore(parent, frag, anchor);

    expect(serializeVNode(parent)).toBe('<main><p>a</p><p>b</p><nav>end</nav></main>');
  });

  it('serializes as bare children when it is the root', () => {
    const frag = createFragment([el('h1', 'title'), el('p', 'body')]);
    expect(serializeVNode(frag)).toBe('<h1>title</h1><p>body</p>');
  });

  it('renders a multi-root component through renderToString', () => {
    const component = {
      render: () => createFragment([el('header', 'top'), el('main', 'middle')]),
    };
    const { html } = renderToString(component);
    expect(html).toBe('<header>top</header><main>middle</main>');
  });

  it('parents children so structural directives resolve inside un-inserted fragments', () => {
    // mirror of the compiled slot closure with fragments on: the u-if anchor
    // is wrapped in the fragment FIRST, and the deferred createIf runs before
    // the fragment is inserted anywhere. the anchor must already have a
    // parent (the fragment), or the conditional content silently vanishes
    // from server output and diverges from the client render.
    const anchor = createComment('u-if');
    const always = el('span', 'always');
    const frag = createFragment([anchor, always]);
    createIf(
      anchor,
      () => true,
      () => el('p', 'sometimes'),
    );

    const parent = createElement('main');
    appendChild(parent, frag);
    expect(serializeVNode(parent)).toBe(
      '<main><p>sometimes</p><!--u-if--><span>always</span></main>',
    );
  });

  it('parents children so u-for resolves inside un-inserted fragments', () => {
    const anchor = createComment('u-for');
    const frag = createFragment([anchor]);
    createFor(
      anchor,
      () => ['a', 'b'],
      (item) => el('li', item),
    );

    const parent = createElement('ul');
    appendChild(parent, frag);
    expect(serializeVNode(parent)).toBe('<ul><li>a</li><li>b</li><!--u-for--></ul>');
  });

  it('renders a multi-root component through renderToStream', async () => {
    const component = {
      render: () => createFragment([el('h2', 'a'), el('h3', 'b')]),
    };
    const stream = renderToStream(component);
    let html = '';
    for await (const chunk of stream) {
      html += chunk;
    }
    expect(html).toBe('<h2>a</h2><h3>b</h3>');
  });
});
