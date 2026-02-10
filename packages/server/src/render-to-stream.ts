// ============================================================================
// @matthesketh/utopia-server — renderToStream
// ============================================================================

import { Readable } from 'node:stream';
import type { VNode, VElement } from './vnode.js';
import type { ComponentDefinition } from './ssr-runtime.js';
import { createComponent, flushStyles } from './ssr-runtime.js';

const VALID_TAG = /^[a-zA-Z][a-zA-Z0-9-]*$/;
function validateTag(tag: string): string {
  if (!VALID_TAG.test(tag)) throw new Error(`Invalid tag name: ${tag}`);
  return tag;
}

const VALID_ATTR = /^[a-zA-Z_:@][a-zA-Z0-9_.:-]*$/;
function validateAttr(name: string): string {
  if (!VALID_ATTR.test(name)) throw new Error(`Invalid attribute name: ${name}`);
  return name;
}

function escapeStyleContent(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

// HTML void elements (self-closing, no closing tag).
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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

  let rendered = false;
  return new Readable({
    read() {
      if (rendered) return;
      rendered = true;
      // Emit a leading CSS <style> block if styles were collected.
      if (styles.length > 0) {
        this.push(`<style>${escapeStyleContent(styles.join('\n'))}</style>`);
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
  let open = `<${validateTag(el.tag)}`;

  for (const [name, value] of Object.entries(el.attrs)) {
    if (value === '') {
      open += ` ${validateAttr(name)}`;
    } else {
      open += ` ${validateAttr(name)}="${escapeAttr(value)}"`;
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

  stream.push(`</${validateTag(el.tag)}>`);
}
