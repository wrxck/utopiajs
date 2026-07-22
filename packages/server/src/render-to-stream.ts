// ============================================================================
// @matthesketh/utopia-server — renderToStream
// ============================================================================

import { Readable } from 'node:stream';
import type { VNode, VElement } from './vnode';
import type { ComponentDefinition } from './ssr-runtime';
import { createComponent, flushStyles, flushHead } from './ssr-runtime';
import {
  VOID_ELEMENTS,
  escapeHtml,
  escapeAttr,
  escapeComment,
  escapeStyleContent,
  validateTag,
  validateAttr,
} from './html-utils';

const MAX_VNODE_DEPTH = 1000;

/**
 * Render a component to a Node.js Readable stream.
 *
 * The stream yields HTML chunks as the VNode tree is walked. This
 * allows the server to begin flushing output before the full tree
 * is serialized, reducing TTFB for large pages. Chunk generation is
 * pull-based: when `push()` signals backpressure, the walk pauses
 * until the consumer drains the buffer.
 */
export function renderToStream(
  component: ComponentDefinition,
  props?: Record<string, any>,
): Readable {
  // Clear any styles left over from a previous render.
  flushStyles();

  const vnode = createComponent(component, props);
  const styles = flushStyles();
  // A stream has no head-injection point, so discard head entries collected
  // during the render — otherwise they accumulate in module state and leak
  // into a later renderToString/flushHead call.
  flushHead();

  const chunks = documentChunks(vnode, styles);
  return new Readable({
    read() {
      try {
        let next = chunks.next();
        while (!next.done) {
          // push() returning false signals backpressure — stop generating;
          // Node calls read() again once the consumer drains the buffer.
          if (!this.push(next.value)) return;
          next = chunks.next();
        }
        this.push(null);
      } catch (err) {
        // all internal throws (validation, depth limit) are Error instances.
        this.destroy(err as Error);
      }
    },
  });
}

/** Yield the leading <style> block (if any) followed by the serialized tree. */
function* documentChunks(vnode: VNode, styles: string[]): Generator<string> {
  if (styles.length > 0) {
    yield `<style>${escapeStyleContent(styles.join('\n'))}</style>`;
  }
  yield* vnodeChunks(vnode, 0);
}

function* vnodeChunks(node: VNode, depth: number): Generator<string> {
  if (depth > MAX_VNODE_DEPTH) {
    throw new Error(`VNode tree exceeded maximum depth of ${MAX_VNODE_DEPTH}`);
  }
  switch (node.type) {
    case 1:
      yield* elementChunks(node, depth);
      return;
    case 2:
      yield escapeHtml(node.text);
      return;
    case 3:
      yield `<!--${escapeComment(node.text)}-->`;
      return;
  }
}

function* elementChunks(el: VElement, depth: number): Generator<string> {
  // validate the tag once and reuse for both the opening and closing tag.
  const tag = validateTag(el.tag);
  let open = `<${tag}`;

  for (const [name, value] of Object.entries(el.attrs)) {
    if (value === '') {
      open += ` ${validateAttr(name)}`;
    } else {
      open += ` ${validateAttr(name)}="${escapeAttr(value)}"`;
    }
  }

  yield open + '>';

  // void elements — no closing tag, no children.
  if (VOID_ELEMENTS.has(el.tag.toLowerCase())) {
    return;
  }

  for (const child of el.children) {
    yield* vnodeChunks(child, depth + 1);
  }

  yield `</${tag}>`;
}
