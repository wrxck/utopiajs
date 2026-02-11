// ============================================================================
// @matthesketh/utopia-server — renderToString
// ============================================================================

import type { VNode, VElement } from './vnode.js';
import type { ComponentDefinition } from './ssr-runtime.js';
import { createComponent, flushStyles } from './ssr-runtime.js';

export const VALID_TAG = /^[a-zA-Z][a-zA-Z0-9-]*$/;
function validateTag(tag: string): string {
  if (!VALID_TAG.test(tag)) throw new Error(`Invalid tag name: ${tag}`);
  return tag;
}

export const VALID_ATTR = /^[a-zA-Z_:@][a-zA-Z0-9_.:-]*$/;
function validateAttr(name: string): string {
  if (!VALID_ATTR.test(name)) throw new Error(`Invalid attribute name: ${name}`);
  return name;
}

// Regex constants for HTML escaping.
export const AMPERSAND_RE = /&/g;
export const LESS_THAN_RE = /</g;
export const GREATER_THAN_RE = />/g;
export const DOUBLE_QUOTE_RE = /"/g;
export const DOUBLE_DASH_RE = /--/g;

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

/**
 * Escape special HTML characters in text content.
 */
function escapeHtml(str: string): string {
  return str
    .replace(AMPERSAND_RE, '&amp;')
    .replace(LESS_THAN_RE, '&lt;')
    .replace(GREATER_THAN_RE, '&gt;');
}

/**
 * Escape special characters in attribute values.
 */
function escapeAttr(str: string): string {
  return str.replace(AMPERSAND_RE, '&amp;').replace(DOUBLE_QUOTE_RE, '&quot;');
}

/**
 * Sanitize comment text by replacing `--` sequences that would
 * prematurely close the comment.
 */
function escapeComment(str: string): string {
  return str.replace(DOUBLE_DASH_RE, '-\u200B-');
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
  let html = `<${validateTag(tag)}`;

  // Attributes
  for (const [name, value] of Object.entries(el.attrs)) {
    if (value === '') {
      html += ` ${validateAttr(name)}`;
    } else {
      html += ` ${validateAttr(name)}="${escapeAttr(value)}"`;
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

  html += `</${validateTag(tag)}>`;
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
  props?: Record<string, unknown>,
): { html: string; css: string } {
  // Flush any previously collected styles.
  flushStyles();

  const vnode = createComponent(component, props);
  const html = serializeVNode(vnode);
  const styles = flushStyles();
  const css = styles.join('\n');

  return { html, css };
}
