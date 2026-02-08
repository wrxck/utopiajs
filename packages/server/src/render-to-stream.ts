// ============================================================================
// @matthesketh/utopia-server — renderToStream
// ============================================================================

import { Readable } from 'node:stream';
import type { VNode, VElement } from './vnode.js';
import type { ComponentDefinition } from './ssr-runtime.js';
import { createComponent, flushStyles } from './ssr-runtime.js';

// HTML void elements (self-closing, no closing tag).
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function escapeComment(str: string): string {
  return str.replace(/--/g, '-\u200B-');
}

/**
 * Render a component to a Node.js Readable stream.
 *
 * The stream yields HTML chunks as the VNode tree is walked. This
 * allows the server to begin flushing output before the full tree
 * is serialized, reducing TTFB for large pages.
 */
export function renderToStream(
  component: ComponentDefinition,
  props?: Record<string, any>,
): Readable {
  flushStyles();

  const vnode = createComponent(component, props);
  const styles = flushStyles();

  return new Readable({
    read() {
      // Emit a leading CSS <style> block if styles were collected.
      if (styles.length > 0) {
        this.push(`<style>${styles.join('\n')}</style>`);
      }

      // Walk the VNode tree and push chunks.
      pushVNode(this, vnode);

      // Signal end of stream.
      this.push(null);
    },
  });
}

function pushVNode(stream: Readable, node: VNode): void {
  switch (node.type) {
    case 1:
      pushElement(stream, node);
      break;
    case 2:
      stream.push(escapeHtml(node.text));
      break;
    case 3:
      stream.push(`<!--${escapeComment(node.text)}-->`);
      break;
  }
}

function pushElement(stream: Readable, el: VElement): void {
  let open = `<${el.tag}`;

  for (const [name, value] of Object.entries(el.attrs)) {
    if (value === '') {
      open += ` ${name}`;
    } else {
      open += ` ${name}="${escapeAttr(value)}"`;
    }
  }

  open += '>';
  stream.push(open);

  if (VOID_ELEMENTS.has(el.tag.toLowerCase())) {
    return;
  }

  for (const child of el.children) {
    pushVNode(stream, child);
  }

  stream.push(`</${el.tag}>`);
}
