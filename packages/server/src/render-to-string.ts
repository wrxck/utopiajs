// ============================================================================
// @matthesketh/utopia-server — renderToString
// ============================================================================

import type { VNode, VElement } from './vnode.js';
import type { ComponentDefinition, HeadConfig } from './ssr-runtime.js';
import { createComponent, flushStyles, flushHead } from './ssr-runtime.js';

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

const MAX_VNODE_DEPTH = 1000;

/**
 * Serialize a VNode tree to an HTML string.
 */
export function serializeVNode(node: VNode, depth: number = 0): string {
  if (depth > MAX_VNODE_DEPTH) {
    throw new Error(`VNode tree exceeded maximum depth of ${MAX_VNODE_DEPTH}`);
  }
  switch (node.type) {
    case 1: // VElement
      return serializeElement(node, depth);
    case 2: // VText
      return escapeHtml(node.text);
    case 3: // VComment
      return `<!--${escapeComment(node.text)}-->`;
  }
}

function serializeElement(el: VElement, depth: number): string {
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
    html += serializeVNode(child, depth + 1);
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
): { html: string; css: string; head: HeadConfig[] } {
  // Flush any previously collected styles and head entries.
  flushStyles();
  flushHead();

  const vnode = createComponent(component, props);
  const html = serializeVNode(vnode);
  const styles = flushStyles();
  const css = styles.join('\n');
  const head = flushHead();

  return { html, css, head };
}

const ALLOWED_SCRIPT_ATTRS = new Set([
  'src',
  'type',
  'async',
  'defer',
  'crossorigin',
  'integrity',
  'nomodule',
  'referrerpolicy',
  'nonce',
]);

const ALLOWED_LINK_ATTRS = new Set([
  'rel',
  'href',
  'type',
  'media',
  'sizes',
  'hreflang',
  'crossorigin',
  'integrity',
  'as',
  'disabled',
  'referrerpolicy',
]);

/**
 * Serialize collected head entries into HTML tags for injection into the
 * document head.
 */
export function serializeHead(entries: HeadConfig[], nonce?: string): string {
  const parts: string[] = [];

  for (const entry of entries) {
    if (entry.title) {
      parts.push(`<title>${escapeHtml(entry.title)}</title>`);
    }
    if (entry.meta) {
      for (const meta of entry.meta) {
        let tag = '<meta';
        if (meta.name) tag += ` name="${escapeAttr(meta.name)}"`;
        if (meta.property) tag += ` property="${escapeAttr(meta.property)}"`;
        tag += ` content="${escapeAttr(meta.content)}">`;
        parts.push(tag);
      }
    }
    if (entry.link) {
      for (const link of entry.link) {
        let tag = '<link';
        for (const [key, value] of Object.entries(link)) {
          if (ALLOWED_LINK_ATTRS.has(key.toLowerCase())) {
            tag += ` ${validateAttr(key)}="${escapeAttr(value)}"`;
          }
        }
        tag += '>';
        parts.push(tag);
      }
    }
    if (entry.script) {
      for (const script of entry.script) {
        let tag = '<script';
        for (const [key, value] of Object.entries(script)) {
          if (ALLOWED_SCRIPT_ATTRS.has(key.toLowerCase())) {
            tag += ` ${validateAttr(key)}="${escapeAttr(value)}"`;
          }
        }
        if (nonce) tag += ` nonce="${escapeAttr(nonce)}"`;
        tag += '></script>';
        parts.push(tag);
      }
    }
  }

  return parts.join('\n');
}
