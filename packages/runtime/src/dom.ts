/**
 * @matthesketh/utopia-runtime — Low-level DOM helpers
 *
 * These thin wrappers are the only layer between compiled .utopia template
 * output and the real DOM. Keeping them minimal makes tree-shaking effective
 * and keeps the runtime footprint small.
 */

import { effect } from '@matthesketh/utopia-core';
import { isHydrating, claimNode, unclaimNode, enterNode, exitNode } from './hydration.js';

// ---------------------------------------------------------------------------
// SVG support
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

const SVG_TAGS = new Set([
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'g',
  'text',
  'tspan',
  'defs',
  'use',
  'clipPath',
  'mask',
  'pattern',
  'image',
  'foreignObject',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'animate',
  'animateTransform',
  'desc',
  'title',
  'metadata',
  'symbol',
]);

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

/** Matches uppercase letters for camelCase → kebab-case conversion. */
export const UPPER_CASE_RE = /([A-Z])/g;

/** Matches kebab-case segments for kebab-case → camelCase conversion. */
export const KEBAB_CHAR_RE = /-([a-z])/g;

// ---------------------------------------------------------------------------
// Node creation
// ---------------------------------------------------------------------------

/** Create a real DOM element for the given tag name. */
export function createElement(tag: string): Element {
  if (isHydrating) {
    const node = claimNode() as HTMLElement;
    if (node && node.nodeType === 1) {
      // Enter this element so child createElement/createTextNode calls
      // walk its children.
      enterNode(node);
      return node;
    }
    if (node) {
      unclaimNode(node);
    }
    console.warn(`[utopia] Hydration mismatch: expected <${tag}>, got`, node);
    const created = SVG_TAGS.has(tag)
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);
    if (node && node.parentNode) {
      node.parentNode.insertBefore(created, node);
      node.parentNode.removeChild(node);
    }
    enterNode(created);
    return created;
  }
  if (SVG_TAGS.has(tag)) {
    return document.createElementNS(SVG_NS, tag);
  }
  return document.createElement(tag);
}

/** Create a DOM text node. */
export function createTextNode(text: string): Text {
  if (isHydrating) {
    const node = claimNode() as Text;
    if (node && node.nodeType === 3) {
      return node;
    }
    if (node) {
      unclaimNode(node);
    }
    console.warn(`[utopia] Hydration mismatch: expected text node, got`, node);
    const created = document.createTextNode(String(text));
    if (node && node.parentNode) {
      node.parentNode.insertBefore(created, node);
      node.parentNode.removeChild(node);
    }
    return created;
  }
  return document.createTextNode(String(text));
}

// ---------------------------------------------------------------------------
// Reactive text
// ---------------------------------------------------------------------------

/**
 * Set the text content of a Text node. The compiler wraps calls to this
 * function inside an `effect()` so the DOM stays in sync with signals.
 */
export function setText(node: Text, value: unknown): void {
  const text = value == null ? '' : String(value);
  if (node.data !== text) {
    node.data = text;
  }
}

// ---------------------------------------------------------------------------
// Reactive HTML
// ---------------------------------------------------------------------------

/**
 * Set the innerHTML of an element reactively. The getter function is wrapped
 * in an effect so the HTML updates when signals change.
 *
 * **Warning:** This sets raw HTML — only use with trusted content.
 */
export function setHtml(el: Element, getter: () => unknown): void {
  effect(() => {
    const value = getter();
    const html = value == null ? '' : String(value);
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
  });
}

// ---------------------------------------------------------------------------
// Safe reactive HTML (with sanitization)
// ---------------------------------------------------------------------------

/**
 * HTML elements whose tags are safe to keep in user content.
 * Anything not in this set is removed (but its text children are kept).
 */
const SAFE_TAGS = new Set([
  'a', 'abbr', 'acronym', 'address', 'article', 'aside',
  'b', 'bdi', 'bdo', 'big', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt',
  'em',
  'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
  'i', 'img', 'ins',
  'kbd',
  'li',
  'main', 'mark', 'menu',
  'nav',
  'ol',
  'p', 'picture', 'pre',
  'q',
  'rp', 'rt', 'ruby',
  's', 'samp', 'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr',
  'u', 'ul',
  'var',
  'wbr',
]);

/**
 * Attributes that are safe on any element.
 * Event handler attributes (on*) and dangerous globals are excluded.
 */
const SAFE_ATTRS = new Set([
  'abbr', 'align', 'alt', 'axis',
  'border',
  'cellpadding', 'cellspacing', 'char', 'charoff', 'charset', 'cite', 'class', 'cols',
  'colspan', 'compact',
  'datetime', 'dir',
  'frame',
  'headers', 'height', 'hreflang',
  'id',
  'lang',
  'nowrap',
  'rel', 'reversed', 'rowspan', 'rules',
  'scope', 'span', 'start', 'summary',
  'tabindex', 'target', 'title', 'type',
  'valign', 'value',
  'width',
]);

/** URI-bearing attributes that must not contain javascript:/data:/vbscript: values. */
const URI_ATTRS = new Set(['href', 'src', 'action', 'cite', 'poster', 'data']);

/** Schemes that are forbidden in URI attributes. */
const DANGEROUS_SCHEME_RE = /^\s*(?:javascript|data|vbscript)\s*:/i;

/**
 * DOM-based HTML sanitizer. Parses the input into an inert document fragment,
 * walks every node, removes disallowed elements and attributes (including all
 * event-handler attributes and dangerous URI schemes), then serialises back to
 * an HTML string.
 *
 * Parsing is done with DOMParser so no user markup ever runs as code during
 * sanitization. The allowlist approach means new bypass techniques (nested
 * tags, slash-separated attributes, SVG vectors, etc.) cannot slip through.
 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><body>${html}</body>`,
    'text/html',
  );

  // Walk the tree bottom-up so removals don't invalidate the iterator.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const elements: Element[] = [];

  let node = walker.nextNode();
  while (node !== null) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      elements.push(node as Element);
    }
    node = walker.nextNode();
  }

  // Process elements in reverse (bottom-up) order.
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    const tag = el.tagName.toLowerCase();

    if (!SAFE_TAGS.has(tag)) {
      // Replace disallowed element with its text content so we don't silently
      // swallow legitimate text inside, e.g. inside <span> inside <div>.
      const frag = doc.createDocumentFragment();
      while (el.firstChild) {
        frag.appendChild(el.firstChild);
      }
      el.parentNode?.replaceChild(frag, el);
      continue;
    }

    // Sanitize attributes on allowed elements.
    const attrsToRemove: string[] = [];
    for (let j = 0; j < el.attributes.length; j++) {
      const attr = el.attributes[j];
      const name = attr.name.toLowerCase();

      // Block all event handlers (on*).
      if (name.startsWith('on')) {
        attrsToRemove.push(attr.name);
        continue;
      }

      // Block dangerous URI schemes in URI-bearing attributes.
      if (URI_ATTRS.has(name)) {
        if (DANGEROUS_SCHEME_RE.test(attr.value)) {
          attrsToRemove.push(attr.name);
        }
        // Allow safe URIs (http, https, mailto, relative, etc.).
        continue;
      }

      // Remove any attribute not on the safe list.
      if (!SAFE_ATTRS.has(name)) {
        attrsToRemove.push(attr.name);
      }
    }

    for (const name of attrsToRemove) {
      el.removeAttribute(name);
    }
  }

  return doc.body.innerHTML;
}

/**
 * Set the innerHTML of an element reactively with basic sanitization.
 * Strips script tags, event handlers, and javascript: URIs.
 *
 * For fully trusted content, use `setHtml()` instead.
 */
export function setSafeHtml(el: Element, getter: () => unknown): void {
  effect(() => {
    const value = getter();
    const raw = value == null ? '' : String(value);
    const html = sanitizeHtml(raw);
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
  });
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/**
 * Set an attribute on an element, handling the many special cases that arise
 * in real-world templates:
 *
 * - **class**: accepts a string or an object `{ active: true, hidden: false }`
 * - **style**: accepts a string or an object `{ color: 'red', fontSize: '14px' }`
 * - **Boolean attributes** (`disabled`, `checked`, `readonly`, `hidden`,
 *   `selected`, `required`, `multiple`, `autofocus`, `autoplay`, `controls`,
 *   `loop`, `muted`, `open`, `novalidate`): set/remove the attribute based on
 *   truthiness, and also set the IDL property where applicable.
 * - **data-* attributes**: set via `el.dataset`
 * - Everything else: plain `setAttribute` / `removeAttribute`.
 */
export function setAttr(el: Element, name: string, value: unknown): void {
  // --- class ---------------------------------------------------------------
  if (name === 'class') {
    if (value == null || value === false) {
      el.removeAttribute('class');
    } else if (typeof value === 'string') {
      // SVG elements have className as a read-only SVGAnimatedString —
      // use setAttribute instead.
      if (el instanceof SVGElement) {
        el.setAttribute('class', value);
      } else {
        el.className = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      const classes: string[] = [];
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (obj[key]) {
          classes.push(key);
        }
      }
      const classStr = classes.join(' ');
      if (el instanceof SVGElement) {
        el.setAttribute('class', classStr);
      } else {
        el.className = classStr;
      }
    }
    return;
  }

  // --- style ---------------------------------------------------------------
  if (name === 'style') {
    const htmlEl = el as HTMLElement;
    if (value == null || value === false) {
      htmlEl.removeAttribute('style');
    } else if (typeof value === 'string') {
      htmlEl.style.cssText = value;
    } else if (typeof value === 'object' && value !== null) {
      // Reset first to avoid stale properties
      htmlEl.style.cssText = '';
      const styleObj = value as Record<string, unknown>;
      for (const prop of Object.keys(styleObj)) {
        const val = styleObj[prop];
        if (val != null) {
          // Support both camelCase and kebab-case property names
          htmlEl.style.setProperty(prop.replace(UPPER_CASE_RE, '-$1').toLowerCase(), String(val));
        }
      }
    }
    return;
  }

  // --- boolean attributes --------------------------------------------------
  const BOOLEAN_ATTRS = new Set([
    'disabled',
    'checked',
    'readonly',
    'hidden',
    'selected',
    'required',
    'multiple',
    'autofocus',
    'autoplay',
    'controls',
    'loop',
    'muted',
    'open',
    'novalidate',
  ]);

  if (BOOLEAN_ATTRS.has(name)) {
    if (value) {
      el.setAttribute(name, '');
      // Also set the IDL property for form elements etc.
      if (name in el) {
        (el as unknown as Record<string, unknown>)[name] = true;
      }
    } else {
      el.removeAttribute(name);
      if (name in el) {
        (el as unknown as Record<string, unknown>)[name] = false;
      }
    }
    return;
  }

  // --- dataset (data-*) attributes -----------------------------------------
  if (name.startsWith('data-')) {
    const key = name.slice(5).replace(KEBAB_CHAR_RE, (_, c: string) => c.toUpperCase());
    (el as HTMLElement).dataset[key] = value == null ? '' : String(value);
    return;
  }

  // --- generic attributes --------------------------------------------------
  if (value == null || value === false) {
    el.removeAttribute(name);
  } else {
    el.setAttribute(name, value === true ? '' : String(value));
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Add an event listener to an element and return a cleanup function that
 * removes it.
 */
export function addEventListener(
  el: Element,
  event: string,
  handler: EventListener,
  options?: AddEventListenerOptions,
): () => void {
  el.addEventListener(event, handler, options);
  return () => {
    el.removeEventListener(event, handler, options);
  };
}

// ---------------------------------------------------------------------------
// DOM mutations
// ---------------------------------------------------------------------------

/** Insert `node` into `parent` before the given `anchor` (or append if null). */
export function insertBefore(parent: Node, node: Node, anchor: Node | null): void {
  parent.insertBefore(node, anchor);
}

/** Remove a node from its parent. No-op if the node has no parent. */
export function removeNode(node: Node): void {
  if (node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

/** Append a child node to a parent. */
export function appendChild(parent: Node, child: Node): void {
  if (isHydrating) {
    // During hydration the child is already in the DOM — exit the
    // element scope so the cursor returns to the parent's next sibling.
    if (child.nodeType === 1) {
      exitNode();
    }
    return;
  }
  parent.appendChild(child);
}

/** Create a DOM comment node. */
export function createComment(text: string): Comment {
  if (isHydrating) {
    const node = claimNode() as Comment;
    if (node && node.nodeType === 8) {
      return node;
    }
    if (node) {
      unclaimNode(node);
    }
    console.warn(`[utopia] Hydration mismatch: expected comment node, got`, node);
    const created = document.createComment(text);
    if (node && node.parentNode) {
      node.parentNode.insertBefore(created, node);
      node.parentNode.removeChild(node);
    }
    return created;
  }
  return document.createComment(text);
}
