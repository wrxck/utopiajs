// ============================================================================
// @matthesketh/utopia-server — renderToString
// ============================================================================

import {
  escapeAttr,
  escapeComment,
  escapeHtml,
  optionMatches,
  RAW_TEXT_ELEMENTS,
  TEXT_SEPARATOR_HTML,
  validateAttr,
  validateTag,
  VOID_ELEMENTS,
} from '@/html-utils';
import type { ComponentDefinition, HeadConfig } from '@/ssr-runtime';
import { createComponent, flushHead, flushStyles } from '@/ssr-runtime';
import type { VElement, VNode } from '@/vnode';

const MAX_VNODE_DEPTH = 1000;

/**
 * Serialize a VNode tree to an HTML string.
 */
export function serializeVNode(node: VNode, depth: number = 0): string {
  // chunks are pushed into a single shared buffer and joined once. the old
  // implementation did `html += serializeVNode(child)` at every level, which
  // re-copied each already-materialised subtree string into its parent —
  // quadratic in total html size × depth. a single array + join is linear.
  const out: string[] = [];
  pushVNode(out, node, depth, null);
  return out.join('');
}

function pushVNode(out: string[], node: VNode, depth: number, selectValue: string | null): void {
  if (depth > MAX_VNODE_DEPTH) {
    throw new Error(`VNode tree exceeded maximum depth of ${MAX_VNODE_DEPTH}`);
  }
  switch (node.type) {
    case 1: // VElement
      pushElement(out, node, depth, selectValue);
      return;
    case 2: // VText
      out.push(escapeHtml(node.text));
      return;
    case 3: // VComment
      out.push(`<!--${escapeComment(node.text)}-->`);
      return;
    case 4: // VFragment — only ever a render root; serialize bare children.
      pushChildren(out, node.children, depth, selectValue, true);
      return;
  }
}

/**
 * Serialize a child list. Adjacent non-empty text nodes get a separator
 * comment between them (not inside raw-text elements, where it would be
 * literal text) so the client's hydration walker sees them as separate nodes.
 */
function pushChildren(
  out: string[],
  children: VNode[],
  depth: number,
  selectValue: string | null,
  separateText: boolean,
): void {
  let prevText = false;
  for (const child of children) {
    if (child.type === 2) {
      if (child.text === '') continue;
      if (prevText && separateText) out.push(TEXT_SEPARATOR_HTML);
      prevText = true;
    } else {
      prevText = false;
    }
    pushVNode(out, child, depth + 1, selectValue);
  }
}

function pushElement(out: string[], el: VElement, depth: number, selectValue: string | null): void {
  // validate the tag once and reuse for both the opening and closing tag.
  const tag = validateTag(el.tag);
  const lowerTag = tag.toLowerCase();
  out.push(`<${tag}`);

  // attributes
  for (const name of Object.keys(el.attrs)) {
    const value = el.attrs[name];
    if (value === '') {
      out.push(` ${validateAttr(name)}`);
    } else {
      out.push(` ${validateAttr(name)}="${escapeAttr(value)}"`);
    }
  }
  if (
    selectValue !== null &&
    lowerTag === 'option' &&
    !('selected' in el.attrs) &&
    optionMatches(el, selectValue)
  ) {
    out.push(' selected');
  }

  // void elements — no closing tag, no children.
  if (VOID_ELEMENTS.has(lowerTag)) {
    out.push('>');
    return;
  }

  out.push('>');

  if (el.html !== undefined) {
    out.push(el.html);
  } else {
    const childSelect =
      lowerTag === 'select' && el._modelValue !== undefined ? el._modelValue : selectValue;
    pushChildren(out, el.children, depth, childSelect, !RAW_TEXT_ELEMENTS.has(lowerTag));
  }

  out.push(`</${tag}>`);
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
