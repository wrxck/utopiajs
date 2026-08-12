/**
 * @matthesketh/utopia-runtime — Runtime directive implementations
 *
 * These functions are called by the code the compiler emits for control-flow
 * constructs (`@if`, `@for`) and child components in .utopia templates.
 */

import { effect, signal } from '@matthesketh/utopia-core';

import type { ComponentDefinition } from '@/component';
import {
  createComponentInstance,
  pushDisposer,
  runSetupAndRender,
  startCapturingDisposers,
  stopCapturingDisposers,
} from '@/component';
import { insertBefore, removeNode } from '@/dom';

/** A DOM Node with optional cleanup/dispose callbacks attached by the runtime. */
interface DisposableNode extends Node {
  __cleanup?: () => void;
}

// ---------------------------------------------------------------------------
// Style deduplication
// ---------------------------------------------------------------------------

const injectedStyles = new Set<string>();

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
  let currentDisposers: (() => void)[] = [];
  let lastConditionTruthy: boolean | undefined;
  let disposed = false;

  // tear down the active branch: dispose the effects captured during its
  // render, run any child-component cleanup, then remove its nodes. without
  // disposing the captured effects, every toggle leaked the previous branch's
  // reactive bindings (they kept firing against detached dom).
  const teardownBranch = (): void => {
    for (const d of currentDisposers) {
      try {
        d();
      } catch {
        /* dispose path must not throw */
      }
    }
    currentDisposers = [];
    for (const node of currentNodes) {
      (node as DisposableNode).__cleanup?.();
      removeNode(node);
    }
    currentNodes.length = 0;
  };

  // render a branch inside its OWN disposer-capture scope so its bindings are
  // owned by the branch (disposed on the next toggle) instead of the
  // surrounding component scope (disposed only on full unmount).
  const renderBranch = (factory: () => Node, parent: Node): void => {
    const prev = startCapturingDisposers();
    let node: Node;
    try {
      node = factory();
    } finally {
      currentDisposers = stopCapturingDisposers(prev);
    }
    currentNodes.push(node);
    insertBefore(parent, node, anchor);
  };

  // render the current branch. when this if is itself a branch returned into an
  // OUTER createIf (an else-if chain, or a u-if used directly as a branch), our
  // anchor is only inserted after the branch factory returns — so the first
  // switch can run before the anchor is connected. rather than drop the branch,
  // retry on a microtask once we have a parent.
  let retryScheduled = false;
  const applyBranch = (): void => {
    const parent = anchor.parentNode;
    if (!parent) {
      if (!retryScheduled) {
        retryScheduled = true;
        queueMicrotask(() => {
          retryScheduled = false;
          if (!disposed && anchor.parentNode) applyBranch();
        });
      }
      return;
    }

    teardownBranch();

    if (lastConditionTruthy) {
      renderBranch(renderTrue, parent);
    } else if (renderFalse) {
      renderBranch(renderFalse, parent);
    }
  };

  const dispose = effect(() => {
    const truthy = !!condition();

    // only switch branches when the truthiness actually changes.
    if (truthy === lastConditionTruthy) {
      return;
    }
    lastConditionTruthy = truthy;
    applyBranch();
    // NOT scheduled. structural work stays synchronous: mounting a branch runs
    // its own bindings' first pass inline, so a newly shown subtree is complete
    // the moment it appears, and everything still settles before paint (a
    // microtask precedes the frame). deferring reconciliation instead would put
    // node identity, focus and caret preservation — the most delicate code in
    // the runtime — behind a queue, for nothing the user could ever see.
  });

  const disposeAll = (): void => {
    if (disposed) return;
    disposed = true;
    dispose();
    teardownBranch();
  };

  // forward teardown to the surrounding scope (component or outer createFor/
  // createIf) so a parent unmount disposes this effect and its live branch —
  // the compiler emits createIf as a bare statement and discards the return.
  pushDisposer(disposeAll);
  return disposeAll;
}

// ---------------------------------------------------------------------------
// createFor
// ---------------------------------------------------------------------------

/**
 * The reactive handle a row gets on its own loop variables.
 *
 * Compiled templates take it as the third parameter of `renderItem` and use
 * both halves; a hand-written `renderItem` can ignore it and keep the plain
 * `(item, index)` contract.
 */
export interface ForItemScope<T> {
  /**
   * Subscribe the calling effect to this row's item. Compiled rows call it at
   * the start of every expression they evaluate reactively, which is what
   * makes the loop variable reactive — a plain `item.name` read registers no
   * dependency, so without this the row's effects would run exactly once.
   */
  track(): void;
  /**
   * Register the row's rebinder. createFor calls it with the current item and
   * index before waking the row's effects, so they read fresh values through
   * the very same loop variables the template was written against.
   */
  onUpdate(fn: (item: T, index: number) => void): void;
}

/**
 * List rendering directive.
 *
 * @param anchor     Comment node marking the insertion point.
 * @param list       Function returning the current array (reads signals).
 * @param renderItem Factory `(item, index, scope) => Node` for each element.
 * @param key        Optional key extractor for keyed diffing.
 * @returns A dispose function.
 */
export function createFor<T>(
  anchor: Comment,
  list: () => T[],
  renderItem: (item: T, index: number, scope: ForItemScope<T>) => Node,
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
  //
  // reuse is only half the story: the row that survives must also start
  // showing the NEW item. keying by `item.id` means the canonical immutable
  // update — items.map(x => ({ ...x, name })) — hits the reuse path with a
  // different object under the same key, and a row whose bindings closed over
  // the first object would render it forever. so every entry owns a version
  // cell: `refresh` rebinds the row's loop variables and bumps the cell, and
  // the row's effects (which read it through ForItemScope.track) re-run
  // against the new item without the node being recreated.
  type Entry = {
    key: string | number;
    node: Node;
    /**
     * For a fragment-rooted row (a multi-root component under `fragments`),
     * the row's real nodes — the fragment itself empties on insertion, so
     * every later move/removal must operate on this range instead.
     */
    nodes: Node[] | null;
    dispose: () => void;
    refresh: (item: T, index: number) => void;
    /** position in the previous reconcile's order — feeds move minimisation. */
    pos: number;
    /** last reconcile pass that reused this entry — unmatched entries are removed. */
    seenPass: number;
  };
  let entries: Entry[] = [];
  // persistent key → entry index, updated incrementally on add/remove so a
  // reconcile doesn't rebuild the whole map just to look up survivors.
  const byKey = new Map<string | number, Entry>();
  let pass = 0;

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
    // value-only key for primitives (the index is deliberately excluded) so a
    // reorder of unique primitives reuses the existing nodes rather than
    // rebuilding the tail. duplicate values collide here and are disambiguated
    // per-occurrence by the `seen` pass below.
    return `__v_${String(item)}`;
  };

  // create + scope an item: returns the entry plus a dispose that runs
  // every effect captured during its renderItem call. on throw we still
  // restore the parent disposer scope before propagating, so a faulty
  // renderItem can't leak the disposer-capture stack.
  const renderEntry = (item: T, index: number, k: string | number): Entry => {
    // bumped on every reconcile this row survives. the value itself is
    // meaningless — it exists to notify, so an unchanged (even identical)
    // item still re-runs the row's bindings and picks up an in-place mutation.
    const version = signal(0);
    let rebind: ((item: T, index: number) => void) | undefined;
    const scope: ForItemScope<T> = {
      track: () => {
        version();
      },
      onUpdate: (fn) => {
        rebind = fn;
      },
    };

    const prev = startCapturingDisposers();
    let node: Node;
    try {
      node = renderItem(item, index, scope);
    } catch (err) {
      stopCapturingDisposers(prev);
      throw err;
    }
    const disposers = stopCapturingDisposers(prev);
    const dispose = (): void => {
      for (const d of disposers) {
        try {
          d();
        } catch {
          /* swallow — dispose path must not throw */
        }
      }
    };
    // rebind before bumping: the effects the bump wakes read the loop
    // variables, so those must already hold the new item and index.
    const refresh = (nextItem: T, nextIndex: number): void => {
      if (rebind) rebind(nextItem, nextIndex);
      version.update((n) => n + 1);
    };
    // snapshot a fragment row's roots before any insertion drains them.
    const nodes = node.nodeType === 11 ? Array.from(node.childNodes) : null;
    return { key: k, node, nodes, dispose, refresh, pos: -1, seenPass: pass };
  };

  // bumped from a microtask to re-run the reconcile once our anchor is
  // connected. see the guard below.
  const anchorAttached = signal(0);
  let retryScheduled = false;
  let listDisposed = false;

  const reconcile = effect(() => {
    const items = list();
    // read unconditionally so a retry always re-runs us.
    anchorAttached();
    const parent = anchor.parentNode;
    if (!parent) {
      // same case createIf handles: when this u-for is returned as a branch of
      // an outer createIf (an else-if chain, or a root-level u-for whose anchor
      // the caller appends after render returns), the first reconcile runs
      // before the anchor is connected. dropping it silently rendered NOTHING
      // for the life of the page whenever the list never changed again, so
      // retry on a microtask instead.
      if (!retryScheduled) {
        retryScheduled = true;
        queueMicrotask(() => {
          retryScheduled = false;
          if (!listDisposed && anchor.parentNode) anchorAttached.update((n) => n + 1);
        });
      }
      return;
    }

    pass++;
    const n = items.length;
    const next: Entry[] = new Array(n);
    const seen = new Set<string | number>();
    // old position of each row in the new order (-1 for freshly created rows),
    // and whether any reused row's old position went backwards — only then is
    // there anything to move, and only then is the LIS worth computing.
    const oldIdx = new Int32Array(n);
    let maxOld = -1;
    let movedBack = false;

    const freshThisPass: Entry[] = [];
    try {
      for (let i = 0; i < n; i++) {
        const item = items[i] as T;
        let k = keyOf(item, i);
        if (seen.has(k)) {
          // duplicate keys are degenerate input; disambiguate per OCCURRENCE
          // (first dup → __dup1, second → __dup2) rather than per index, so a
          // reorder of identical items keeps the same key set and reuses every
          // node instead of rebuilding the ones whose index changed.
          let dup = 1;
          let dk = `${k}__dup${dup}`;
          while (seen.has(dk)) {
            dup++;
            dk = `${k}__dup${dup}`;
          }
          k = dk;
        }
        seen.add(k);
        const existing = byKey.get(k);
        if (existing) {
          existing.refresh(item, i);
          existing.seenPass = pass;
          next[i] = existing;
          oldIdx[i] = existing.pos;
          if (existing.pos < maxOld) {
            movedBack = true;
          } else {
            maxOld = existing.pos;
          }
        } else {
          next[i] = renderEntry(item, i, k);
          byKey.set(k, next[i]);
          freshThisPass.push(next[i]);
          oldIdx[i] = -1;
        }
      }
    } catch (err) {
      // a throwing renderItem must not strand the rows already created this
      // pass: they sit in byKey but will never enter `entries`, so nothing
      // would ever dispose them and a later pass could reuse a never-inserted
      // row. evict and dispose them, then let the error propagate.
      for (const e of freshThisPass) {
        byKey.delete(e.key);
        try {
          e.dispose();
        } catch {
          /* dispose path must not throw — the original error propagates */
        }
      }
      throw err;
    }

    // remove nodes whose keys are gone, disposing their captured effects. a
    // fragment row's real nodes live in its recorded range, not the (empty)
    // fragment object.
    for (const e of entries) {
      if (e.seenPass !== pass) {
        byKey.delete(e.key);
        try {
          e.dispose();
        } catch {
          /* dispose path must not throw — teardown of the rest must proceed */
        }
        if (e.nodes) {
          for (const r of e.nodes) {
            if (r.parentNode === parent) parent.removeChild(r);
          }
        } else if (e.node.parentNode === parent) {
          parent.removeChild(e.node);
        }
      }
    }

    // walk backwards from the anchor to coerce the dom into matching the
    // desired order. rows on a longest increasing subsequence of old
    // positions are already in relative order and stay put; only the rest
    // (and fresh rows) get an insertBefore call. without the LIS, any node
    // not adjacent to the walk cursor was moved, so a single head→tail move
    // cost O(n) dom moves instead of one.
    //
    // in-place rows are trusted from bookkeeping, not re-checked against the
    // dom — outside code that detaches or reorders a row's nodes between
    // reconciles is outside createFor's contract (the old exhaustive
    // adjacency check repaired that only incidentally, at the price of O(n)
    // moves for a single displaced row).
    const stable = movedBack ? lisPositions(oldIdx) : null;
    let cursor: Node = anchor;
    for (let i = n - 1; i >= 0; i--) {
      const e = next[i]!;
      e.pos = i;
      const roots = e.nodes;
      if (roots && roots.length === 0) continue; // empty row occupies nothing
      const first = roots ? roots[0]! : e.node;
      const last = roots ? roots[roots.length - 1]! : e.node;
      const inPlace = stable ? stable.has(i) : oldIdx[i] !== -1;
      if (!inPlace && last.nextSibling !== cursor) {
        if (roots) {
          for (const r of roots) {
            parent.insertBefore(r, cursor);
          }
        } else {
          parent.insertBefore(e.node, cursor);
        }
      }
      cursor = first;
    }

    entries = next;
    // NOT scheduled — see createIf above.
  });

  const disposeAll = (): void => {
    listDisposed = true;
    reconcile();
    const parent = anchor.parentNode;
    for (const e of entries) {
      try {
        e.dispose();
      } catch {
        /* dispose path must not throw — teardown of the rest must proceed */
      }
      if (!parent) continue;
      if (e.nodes) {
        for (const r of e.nodes) {
          if (r.parentNode === parent) parent.removeChild(r);
        }
      } else if (e.node.parentNode === parent) {
        parent.removeChild(e.node);
      }
    }
    entries = [];
    byKey.clear();
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

/**
 * Positions forming a longest increasing subsequence of the non-negative
 * values of `oldIdx` (fresh rows are -1 and never participate). O(n log n)
 * patience sort with a predecessor chain; values are distinct because they
 * are positions in the previous order.
 */
function lisPositions(oldIdx: Int32Array): Set<number> {
  // tails[len] = position whose value ends the best subsequence of length len+1
  const tails: number[] = [];
  const prev = new Int32Array(oldIdx.length).fill(-1);
  for (let i = 0; i < oldIdx.length; i++) {
    const v = oldIdx[i]!;
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (oldIdx[tails[mid]!]! < v) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const result = new Set<number>();
  let p = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (p >= 0) {
    result.add(p);
    p = prev[p]!;
  }
  return result;
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

  // Run setup() + render() inside one disposer-capture scope so effects
  // created during setup belong to THIS component's cleanup (important for
  // async mounts like defineLazy, where no outer scope is active).
  const { el, mountCallbacks, destroyCallbacks, disposers } = runSetupAndRender(
    def,
    instance.props,
    instance.slots,
  );
  instance.el = el;

  // Inject scoped styles if the definition carries them (deduplicated).
  if (def.styles && !injectedStyles.has(def.styles)) {
    injectedStyles.add(def.styles);
    const style = document.createElement('style');
    style.textContent = def.styles;
    document.head.appendChild(style);
  }

  // Run onMount callbacks.
  for (const cb of mountCallbacks) {
    cb();
  }

  // attach a cleanup function to the node so callers can dispose effects and
  // run onDestroy callbacks. the flag makes it idempotent because the cleanup
  // is reachable from two paths (pushDisposer below + a createIf branch
  // teardown that also calls node.__cleanup directly).
  const node = instance.el;
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    for (const cb of destroyCallbacks) {
      try {
        cb();
      } catch {
        /* a faulty onDestroy must not abort teardown of the rest */
      }
    }
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* dispose path must not throw */
      }
    }
  };
  (node as DisposableNode).__cleanup = cleanup;

  // register with the surrounding capture scope (parent component, createFor
  // item, createIf branch) so this child's effects + onDestroy are torn down
  // when the parent unmounts — previously child components leaked on unmount
  // because nothing forwarded their cleanup to the parent scope.
  pushDisposer(cleanup);

  return node;
}
