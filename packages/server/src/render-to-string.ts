// ============================================================================
// @utopia/server — renderToString
// ============================================================================

import type { VNode, VElement } from './vnode.js';
import type { ComponentDefinition } from './ssr-runtime.js';
import { createComponent, flushStyles } from './ssr-runtime.js';

// HTML void elements (self-closing, no closing tag).
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Escape special HTML characters in text content.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape special characters in attribute values.
 */
function escapeAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitize comment text by replacing `--` sequences that would
 * prematurely close the comment.
 */
function escapeComment(str: string): string {
  return str.replace(/--/g, '-\u200B-');
}

/**
 * Serialize a VNode tree to an HTML string.
 */
export function serializeVNode(node: VNode): string {
  switch (node.type) {
    case 1: // VElement
      return serializeElement(node);
    case 2: // VText
      return escapeHtml(node.text);
    case 3: // VComment
      return `<!--${escapeComment(node.text)}-->`;
  }
}

function serializeElement(el: VElement): string {
  const tag = el.tag;
  let html = `<${tag}`;

  // Attributes
  for (const [name, value] of Object.entries(el.attrs)) {
    if (value === '') {
      html += ` ${name}`;
    } else {
      html += ` ${name}="${escapeAttr(value)}"`;
    }
  }

  // Void elements — no closing tag, no children.
  if (VOID_ELEMENTS.has(tag.toLowerCase())) {
    html += '>';
    return html;
  }

  html += '>';

  // Children
  for (const child of el.children) {
    html += serializeVNode(child);
  }

  html += `</${tag}>`;
  return html;
}

/**
 * Render a component to an HTML string.
 *
 * @returns An object with `html` (the rendered markup) and `css` (all
 *          scoped styles collected during rendering).
 */
export function renderToString(
  component: ComponentDefinition,
  props?: Record<string, any>,
): { html: string; css: string } {
  // Flush any previously collected styles.
  flushStyles();

  const vnode = createComponent(component, props);
  const html = serializeVNode(vnode);
  const styles = flushStyles();
  const css = styles.join('\n');

  return { html, css };
}
