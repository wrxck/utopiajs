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
  pushDisposer,
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
  // keyed reconciliation: on every list update we diff the new array
  // against the previous one by key. nodes whose key still exists are
  // reused — and moved if their position changed. only added/removed/
  // reordered keys touch the dom. without this every signal update that
  // produced a structurally identical array tore down every item and
  // rebuilt it from scratch (the previous "naive clear-and-rebuild"
  // strategy), visible as flickering values, lost focus, and taps landing
  // on detached dom nodes.
  //
  // each rendered item gets its OWN captured-disposer scope so its inner
  // createEffect calls are tied to the item's lifetime, not the parent
  // createFor's. that means:
  //   - reused items keep their reactive bindings firing
  //   - removed items dispose their effects (no leak, no orphaned updates)
  //   - new items capture fresh and register with the parent component
  //
  // the disposers are also forwarded to the surrounding scope (the
  // component or the calling createFor) via pushDisposer so unmount still
  // sweeps everything up.
  type Entry = { key: string | number; node: Node; dispose: () => void };
  let entries: Entry[] = [];

  const keyOf = (item: T, index: number): string | number => {
    if (key) return key(item, index);
    if (item !== null && typeof item === 'object') {
      const id = (item as Record<string, unknown>).id;
      if (typeof id === 'string' || typeof id === 'number') return id;
      // identity fallback — same object → same key across re-renders.
      let hash = identityKeys.get(item as object);
      if (hash === undefined) {
        hash = nextIdentityKey++;
        identityKeys.set(item as object, hash);
      }
      return `__id_${hash}`;
    }
    return `__v_${index}_${String(item)}`;
  };

  // create + scope an item: returns the entry plus a dispose that runs
  // every effect captured during its renderItem call. on throw we still
  // restore the parent disposer scope before propagating, so a faulty
  // renderItem can't leak the disposer-capture stack.
  const renderEntry = (item: T, index: number, k: string | number): Entry => {
    const prev = startCapturingDisposers();
    let node: Node;
    try {
      node = renderItem(item, index);
    } catch (err) {
      stopCapturingDisposers(prev);
      throw err;
    }
    const disposers = stopCapturingDisposers(prev);
    const dispose = (): void => {
      for (const d of disposers) {
        try { d(); } catch { /* swallow — dispose path must not throw */ }
      }
    };
    return { key: k, node, dispose };
  };

  const reconcile = effect(() => {
    const items = list();
    const parent = anchor.parentNode;
    if (!parent) return;

    const prevByKey = new Map<string | number, Entry>();
    for (const e of entries) prevByKey.set(e.key, e);

    const next: Entry[] = new Array(items.length);
    const seen = new Set<string | number>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i] as T;
      let k = keyOf(item, i);
      // duplicate keys are degenerate input; suffix per-position so two
      // identical keys at different indices don't collide on lookup.
      while (seen.has(k)) k = `${k}__dup${i}`;
      seen.add(k);
      const existing = prevByKey.get(k);
      if (existing) {
        next[i] = existing;
        prevByKey.delete(k);
      } else {
        next[i] = renderEntry(item, i, k);
      }
    }

    // remove nodes whose keys are gone, disposing their captured effects.
    for (const e of prevByKey.values()) {
      try { e.dispose(); } catch { /* ignore */ }
      if (e.node.parentNode === parent) parent.removeChild(e.node);
    }

    // walk backwards from the anchor to coerce the dom into matching the
    // desired order. nodes already in position are left alone; only
    // out-of-order nodes get an insertBefore call.
    let cursor: Node = anchor;
    for (let i = items.length - 1; i >= 0; i--) {
      const e = next[i]!;
      if (e.node.nextSibling !== cursor) {
        parent.insertBefore(e.node, cursor);
      }
      cursor = e.node;
    }

    entries = next;
  });

  const disposeAll = (): void => {
    reconcile();
    const parent = anchor.parentNode;
    for (const e of entries) {
      try { e.dispose(); } catch { /* ignore */ }
      if (parent && e.node.parentNode === parent) parent.removeChild(e.node);
    }
    entries = [];
  };

  // forward our own dispose to the caller's scope (component or outer
  // createFor) so a parent unmount tears the whole list down properly.
  pushDisposer(disposeAll);
  return disposeAll;
}

// shared across all createFor instances — entries fall out of the weakmap
// when no list keeps the source object alive.
const identityKeys: WeakMap<object, number> = new WeakMap();
let nextIdentityKey = 0;

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
  Component: ComponentDefinition | (() => ComponentDefinition),
  props?: Record<string, unknown>,
  children?: Record<string, () => Node>,
): Node {
  // Support function components: call them to get the definition.
  const resolved =
    typeof Component === 'function' && !('render' in Component) ? Component() : Component;

  // If the resolved value is a plain Node, return it directly.
  if (resolved instanceof Node) {
    return resolved;
  }

  const instance = createComponentInstance(resolved as ComponentDefinition, props);

  // Attach slot factories if provided.
  if (children) {
    for (const slotName of Object.keys(children)) {
      instance.slots[slotName] = children[slotName];
    }
  }

  const def = resolved as ComponentDefinition;

  // Run the render pipeline, capturing lifecycle hooks during setup.
  startCapturingLifecycle();
  const ctx = def.setup ? def.setup(instance.props) : {};
  const lifecycle = stopCapturingLifecycle();

  // Merge slots into the render context so templates can reference them.
  const renderCtx: Record<string, unknown> = {
    ...ctx,
    $slots: instance.slots,
  };

  // Capture effect disposers created during render.
  const prev = startCapturingDisposers();
  instance.el = def.render(renderCtx);
  const disposers = stopCapturingDisposers(prev);

  // Inject scoped styles if the definition carries them (deduplicated).
  if (def.styles && !injectedStyles.has(def.styles)) {
    injectedStyles.add(def.styles);
    const style = document.createElement('style');
    style.textContent = def.styles;
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
