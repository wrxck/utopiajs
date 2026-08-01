// ============================================================================
// @matthesketh/utopia-runtime — Hydration
// ============================================================================
//
// Cursor-based DOM walker that claims existing server-rendered nodes instead
// of creating new ones. After hydration, the component is fully interactive
// with signal tracking and event listeners attached.
// ============================================================================

import { createComponentInstance, runSetupAndRender } from '@/component';
import type { ComponentDefinition, ComponentInstance } from '@/component';

// ---------------------------------------------------------------------------
// Hydration state — module-level so dom.ts helpers can check it
// ---------------------------------------------------------------------------

/** Whether we are currently hydrating (claiming existing DOM nodes). */
export let isHydrating = false;

/** The current DOM node cursor during hydration. */
let hydrateNode: Node | null = null;

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
): ComponentInstance {
  const el = typeof target === 'string' ? document.querySelector(target) : target;

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

    // Run setup() + render() inside one disposer-capture scope (mirrors
    // ComponentInstance.mount) so setup- and render-created effects are all
    // disposed when the hydrated instance unmounts.
    const result = runSetupAndRender(component, instance.props, instance.slots);
    instance.el = result.el;
    let { disposers } = result;

    // Inject styles (same as normal mount).
    let styleElement: HTMLStyleElement | null = null;
    if (component.styles) {
      styleElement = document.createElement('style');
      styleElement.textContent = component.styles;
      document.head.appendChild(styleElement);
    }

    // Run onMount callbacks after DOM claiming.
    for (const cb of result.mountCallbacks) {
      cb();
    }

    // The instance was never mount()ed, so its internal unmount knows nothing
    // about the disposers/lifecycle captured here — wrap it so unmounting a
    // hydrated instance runs onDestroy, disposes effects, and removes styles
    // instead of leaking them.
    let destroyCallbacks = result.destroyCallbacks;
    const baseUnmount = instance.unmount;
    instance.unmount = (): void => {
      for (const cb of destroyCallbacks) {
        cb();
      }
      destroyCallbacks = [];
      for (const dispose of disposers) {
        dispose();
      }
      disposers = [];
      if (styleElement && styleElement.parentNode) {
        styleElement.parentNode.removeChild(styleElement);
      }
      styleElement = null;
      baseUnmount();
    };

    return instance;
  } finally {
    // Exit hydration mode.
    isHydrating = false;
    hydrateNode = null;
    cursorStack.length = 0;
  }
}
