/**
 * @matthesketh/utopia-runtime — Runtime directive implementations
 *
 * These functions are called by the code the compiler emits for control-flow
 * constructs (`@if`, `@for`) and child components in .utopia templates.
 */

import { effect } from '@matthesketh/utopia-core';
import { insertBefore, removeNode } from './dom.js';
import {
  createComponentInstance,
  startCapturingDisposers,
  stopCapturingDisposers,
  startCapturingLifecycle,
  stopCapturingLifecycle,
} from './component.js';
import type { ComponentDefinition } from './component.js';

/** A DOM Node with optional cleanup/dispose callbacks attached by the runtime. */
interface DisposableNode extends Node {
  __cleanup?: () => void;
}

// ---------------------------------------------------------------------------
// Style deduplication
// ---------------------------------------------------------------------------

const injectedStyles = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Remove an array of DOM nodes (and run their __cleanup if present) and clear
 * the array in-place.
 */
function clearNodes(nodes: Node[]): void {
  for (const node of nodes) {
    if ((node as DisposableNode).__cleanup) {
      (node as DisposableNode).__cleanup!();
    }
    removeNode(node);
  }
  nodes.length = 0;
}

// ---------------------------------------------------------------------------
// createIf
// ---------------------------------------------------------------------------

/**
 * Conditional rendering directive.
 *
 * @param anchor    A Comment node already in the DOM that marks the insertion
 *                  point. All branch nodes are inserted immediately before it.
 * @param condition A function that returns a truthy/falsy value (typically
 *                  reading a signal so the effect tracks it).
 * @param renderTrue  Factory that produces the DOM subtree for the "true" branch.
 * @param renderFalse Optional factory for the "false" / else branch.
 * @returns A dispose function that tears down the effect and removes nodes.
 */
export function createIf(
  anchor: Comment,
  condition: () => unknown,
  renderTrue: () => Node,
  renderFalse?: () => Node,
): () => void {
  let currentNodes: Node[] = [];
  let lastConditionTruthy: boolean | undefined;

  const dispose = effect(() => {
    const truthy = !!condition();

    // Only switch branches when the truthiness actually changes.
    if (truthy === lastConditionTruthy) {
      return;
    }
    lastConditionTruthy = truthy;

    const parent = anchor.parentNode;
    if (!parent) return;

    // Tear down existing branch nodes.
    clearNodes(currentNodes);

    if (truthy) {
      const node = renderTrue();
      currentNodes.push(node);
      insertBefore(parent, node, anchor);
    } else if (renderFalse) {
      const node = renderFalse();
      currentNodes.push(node);
      insertBefore(parent, node, anchor);
    }
  });

  return () => {
    dispose();
    clearNodes(currentNodes);
  };
}

// ---------------------------------------------------------------------------
// createFor
// ---------------------------------------------------------------------------

/**
 * List rendering directive.
 *
 * @param anchor     Comment node marking the insertion point.
 * @param list       Function returning the current array (reads signals).
 * @param renderItem Factory `(item, index) => Node` for each element.
 * @param key        Optional key extractor for future keyed-diffing optimisation.
 * @returns A dispose function.
 */
export function createFor<T>(
  anchor: Comment,
  list: () => T[],
  renderItem: (item: T, index: number) => Node,
  key?: (item: T, index: number) => string | number,
): () => void {
  let currentNodes: Node[] = [];

  // We intentionally mark `key` as used so that linters / TS don't complain.
  // It's reserved for the future keyed-diffing optimisation.
  void key;

  const dispose = effect(() => {
    const items = list();

    const parent = anchor.parentNode;
    if (!parent) return;

    // --- Simple strategy: clear everything and re-render. ---
    // This is intentionally naive. A keyed reconciliation algorithm will
    // replace this path once the framework stabilises.
    clearNodes(currentNodes);

    for (let i = 0; i < items.length; i++) {
      const node = renderItem(items[i], i);
      currentNodes.push(node);
      insertBefore(parent, node, anchor);
    }
  });

  return () => {
    dispose();
    clearNodes(currentNodes);
  };
}

// ---------------------------------------------------------------------------
// createComponent
// ---------------------------------------------------------------------------

/**
 * Mount a child component at the given anchor position.
 *
 * @param Component  The compiled component definition (has `setup`, `render`,
 *                   and optional `styles`).
 * @param props      Props object to pass to the component's setup function.
 * @param children   Optional slot/children map. Each key maps to a function
 *                   that returns a DOM node for that slot.
 * @returns The root DOM node of the mounted component.
 */
export function createComponent(
  Component: ComponentDefinition,
  props?: Record<string, unknown>,
  children?: Record<string, () => Node>,
): Node {
  const instance = createComponentInstance(Component, props);

  // Attach slot factories if provided.
  if (children) {
    for (const slotName of Object.keys(children)) {
      instance.slots[slotName] = children[slotName];
    }
  }

  // Run the render pipeline, capturing lifecycle hooks during setup.
  startCapturingLifecycle();
  const ctx = Component.setup ? Component.setup(instance.props) : {};
  const lifecycle = stopCapturingLifecycle();

  // Merge slots into the render context so templates can reference them.
  const renderCtx: Record<string, unknown> = {
    ...ctx,
    $slots: instance.slots,
  };

  // Capture effect disposers created during render.
  const prev = startCapturingDisposers();
  instance.el = Component.render(renderCtx);
  const disposers = stopCapturingDisposers(prev);

  // Inject scoped styles if the definition carries them (deduplicated).
  if (Component.styles && !injectedStyles.has(Component.styles)) {
    injectedStyles.add(Component.styles);
    const style = document.createElement('style');
    style.textContent = Component.styles;
    document.head.appendChild(style);
  }

  // Run onMount callbacks.
  for (const cb of lifecycle.mount) {
    cb();
  }

  // Attach a cleanup function to the node so callers can dispose effects
  // and run onDestroy callbacks.
  const node = instance.el;
  (node as DisposableNode).__cleanup = () => {
    for (const cb of lifecycle.destroy) {
      cb();
    }
    for (const dispose of disposers) {
      dispose();
    }
  };

  return node;
}
