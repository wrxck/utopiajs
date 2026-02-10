/**
 * @matthesketh/utopia-runtime — Low-level DOM helpers
 *
 * These thin wrappers are the only layer between compiled .utopia template
 * output and the real DOM. Keeping them minimal makes tree-shaking effective
 * and keeps the runtime footprint small.
 */

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
      el.className = value;
    } else if (typeof value === 'object' && value !== null) {
      const classes: string[] = [];
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (obj[key]) {
          classes.push(key);
        }
      }
      el.className = classes.join(' ');
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
          htmlEl.style.setProperty(prop.replace(/([A-Z])/g, '-$1').toLowerCase(), String(val));
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
    const key = name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
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
