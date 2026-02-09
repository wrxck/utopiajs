// ============================================================================
// @matthesketh/utopia-runtime — Hydration
// ============================================================================
//
// Cursor-based DOM walker that claims existing server-rendered nodes instead
// of creating new ones. After hydration, the component is fully interactive
// with signal tracking and event listeners attached.
// ============================================================================

import { createComponentInstance } from './component.js';
import type { ComponentDefinition } from './component.js';

// ---------------------------------------------------------------------------
// Hydration state — module-level so dom.ts helpers can check it
// ---------------------------------------------------------------------------

/** Whether we are currently hydrating (claiming existing DOM nodes). */
export let isHydrating = false;

/** The current DOM node cursor during hydration. */
export let hydrateNode: Node | null = null;

/**
 * Stack for saving/restoring cursor position when entering/exiting
 * child element scopes.
 */
const cursorStack: (Node | null)[] = [];

// ---------------------------------------------------------------------------
// Cursor operations (used by hydration-aware dom.ts helpers)
// ---------------------------------------------------------------------------

/**
 * Claim the current cursor node and advance to the next sibling.
 * Returns the claimed node.
 */
export function claimNode(): Node | null {
  const node = hydrateNode;
  if (node) {
    hydrateNode = node.nextSibling;
  }
  return node;
}

/**
 * Rewind the cursor back to a previously claimed node. Used when a claimed
 * node does not match expectations (e.g., expected text but got element) so
 * that the cursor does not become permanently misaligned.
 */
export function unclaimNode(node: Node): void {
  hydrateNode = node;
}

/**
 * Enter a child scope: push the current cursor onto the stack and set
 * the cursor to the first child of the given element.
 */
export function enterNode(el: Node): void {
  cursorStack.push(hydrateNode);
  hydrateNode = el.firstChild;
}

/**
 * Exit a child scope: restore the cursor from the stack.
 */
export function exitNode(): void {
  hydrateNode = cursorStack.pop() ?? null;
}

// ---------------------------------------------------------------------------
// hydrate() — Public entry point
// ---------------------------------------------------------------------------

/**
 * Hydrate a server-rendered component. Instead of creating new DOM nodes,
 * the runtime claims the existing nodes in the target element and attaches
 * event listeners and reactive effects.
 *
 * @param component - The compiled component definition
 * @param target    - A CSS selector string or DOM Element containing the
 *                    server-rendered HTML
 */
export function hydrate(
  component: ComponentDefinition,
  target: string | Element,
): void {
  const el =
    typeof target === 'string'
      ? document.querySelector(target)
      : target;

  if (!el) {
    throw new Error(
      `[utopia] Hydration target not found: ${typeof target === 'string' ? target : 'Element'}`,
    );
  }

  // Enter hydration mode.
  isHydrating = true;
  hydrateNode = el.firstChild;

  try {
    const instance = createComponentInstance(component);

    // Run the normal mount flow. The hydration-aware helpers in dom.ts
    // will claim existing nodes instead of creating new ones.
    const ctx = component.setup
      ? component.setup(instance.props)
      : {};

    const renderCtx: Record<string, any> = {
      ...ctx,
      $slots: instance.slots,
    };

    // Render — this runs the compiled template code which calls
    // createElement, createTextNode, etc. During hydration these
    // claim existing DOM nodes.
    instance.el = component.render(renderCtx);

    // Inject styles (same as normal mount).
    if (component.styles) {
      const style = document.createElement('style');
      style.textContent = component.styles;
      document.head.appendChild(style);
    }
  } finally {
    // Exit hydration mode.
    isHydrating = false;
    hydrateNode = null;
    cursorStack.length = 0;
  }
}
