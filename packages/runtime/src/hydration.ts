// ============================================================================
// @matthesketh/utopia-runtime — Hydration
// ============================================================================
//
// Cursor-based DOM walker that claims existing server-rendered nodes instead
// of creating new ones. After hydration, the component is fully interactive
// with signal tracking and event listeners attached.
//
// The server/client contract (see @matthesketh/utopia-server's serializers):
//
//   - Adjacent non-empty text nodes are separated by a `<!--|-->` comment, so
//     `Hello {{ name }}!` arrives as three text nodes rather than one. An empty
//     text node has no server markup at all; the client creates it in place.
//   - Every `u-if` / `u-for` anchor is preceded by a `<!--[-->` comment that
//     opens its range: `<!--[-->` branch-or-rows `<!--u-if-->`. The compiled
//     code creates the anchor BEFORE it renders the branch, so the walker
//     skips the range when it claims the anchor, and createIf / createFor
//     claim the range's nodes when they render their first pass.
//
// Any node the server did not produce is created and inserted at the cursor,
// and any server node the client did not claim is removed, so a mismatch
// degrades to a local repair instead of a misaligned walk for the rest of the
// page.
// ============================================================================

import type { ComponentDefinition, ComponentInstance } from '@/component';
import { createComponentInstance, runSetupAndRender } from '@/component';

/** Comment data separating adjacent server-rendered text nodes. */
export const TEXT_SEPARATOR = '|';

/** Comment data opening a `u-if` / `u-for` range in server markup. */
export const RANGE_OPEN = '[';

/** Anchor comment data the compiler emits for structural directives. */
const RANGE_ANCHORS = new Set(['u-if', 'u-for']);

// ---------------------------------------------------------------------------
// Hydration state — module-level so dom.ts helpers can check it
// ---------------------------------------------------------------------------

/** Whether we are currently hydrating (claiming existing DOM nodes). */
export let isHydrating = false;

/** The current DOM node cursor during hydration. */
let hydrateNode: Node | null = null;

/** The element (or range parent) the cursor walks the children of. */
let hydrateParent: Node | null = null;

/**
 * Exclusive end of the current walk — a directive's anchor while its range is
 * hydrated. The walker never claims past it; nodes created at the end of the
 * range are inserted before it.
 */
let hydrateEnd: Node | null = null;

interface CursorFrame {
  node: Node | null;
  parent: Node | null;
  end: Node | null;
}

/**
 * Stack for saving/restoring cursor position when entering/exiting
 * child element scopes.
 */
const cursorStack: CursorFrame[] = [];

/** Server ranges found while claiming anchors, keyed by the anchor. */
const pendingRanges = new WeakMap<Node, Node>();

// ---------------------------------------------------------------------------
// Cursor operations (used by hydration-aware dom.ts helpers)
// ---------------------------------------------------------------------------

/** The cursor node, or null at the end of the current walk. */
export function peekNode(): Node | null {
  return hydrateNode === hydrateEnd ? null : hydrateNode;
}

/**
 * Claim the current cursor node and advance to the next sibling.
 * Returns the claimed node.
 */
export function claimNode(): Node | null {
  const node = peekNode();
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
 * Put a node the server did not render into the DOM at the cursor, leaving the
 * cursor where it was. Compiled code calls `appendChild` on it next, which is
 * a no-op while hydrating — without this the node would never be attached.
 */
export function insertAtCursor(node: Node): void {
  if (hydrateParent) {
    hydrateParent.insertBefore(node, hydrateNode ?? hydrateEnd);
  }
}

/**
 * Replace a mismatched server node with the one the client built, and move
 * the cursor past it. The cursor used to be rewound to the removed node,
 * whose `nextSibling` is null once detached — so every later claim in the
 * same parent missed.
 */
export function replaceAtCursor(stale: Node, node: Node): void {
  const parent = stale.parentNode;
  if (parent) {
    parent.insertBefore(node, stale);
    parent.removeChild(stale);
    hydrateNode = node.nextSibling;
  } else {
    insertAtCursor(node);
  }
}

/**
 * Enter a child scope: push the current cursor onto the stack and set
 * the cursor to the first child of the given element.
 */
export function enterNode(el: Node): void {
  cursorStack.push({ node: hydrateNode, parent: hydrateParent, end: hydrateEnd });
  hydrateNode = el.firstChild;
  hydrateParent = el;
  hydrateEnd = null;
}

/**
 * Exit a child scope: restore the cursor from the stack.
 */
export function exitNode(): void {
  const frame = cursorStack.pop();
  hydrateNode = frame ? frame.node : null;
  hydrateParent = frame ? frame.parent : null;
  hydrateEnd = frame ? frame.end : null;
}

/**
 * After claiming a text node, drop the separator the server wrote after it so
 * the next text node claims its own server text.
 */
export function skipTextSeparator(): void {
  const node = peekNode();
  if (node && node.nodeType === 8 && (node as Comment).data === TEXT_SEPARATOR) {
    hydrateNode = node.nextSibling;
    node.parentNode?.removeChild(node);
  }
}

/**
 * Claim a directive anchor. When the cursor sits on the server's range-open
 * marker, the anchor is the matching anchor comment further along; the nodes
 * in between belong to the directive and are recorded for its first render.
 * Returns null when the cursor is not on a range (older markup, or a
 * mismatch), in which case the caller falls back to a plain claim.
 */
export function claimRangeAnchor(data: string): Comment | null {
  if (!RANGE_ANCHORS.has(data)) return null;
  const open = peekNode();
  if (!open || open.nodeType !== 8 || (open as Comment).data !== RANGE_OPEN) return null;

  let depth = 1;
  let node = open.nextSibling;
  while (node && node !== hydrateEnd) {
    if (node.nodeType === 8) {
      const d = (node as Comment).data;
      if (d === RANGE_OPEN) depth++;
      else if (RANGE_ANCHORS.has(d) && --depth === 0) break;
    }
    node = node.nextSibling;
  }
  if (!node || node === hydrateEnd || (node as Comment).data !== data) return null;

  const anchor = node as Comment;
  pendingRanges.set(anchor, open.nextSibling ?? anchor);
  hydrateNode = anchor.nextSibling;
  open.parentNode?.removeChild(open);
  return anchor;
}

/** Saved walker state while a directive hydrates its range. */
export interface RangeWalk {
  saved: CursorFrame;
  depth: number;
  anchor: Node;
}

/**
 * Begin walking the server range recorded for `anchor`, or return null when
 * there is none (not hydrating, or the anchor was built fresh).
 */
export function beginRange(anchor: Node): RangeWalk | null {
  if (!isHydrating) return null;
  const start = pendingRanges.get(anchor);
  if (start === undefined) return null;
  pendingRanges.delete(anchor);
  const walk: RangeWalk = {
    saved: { node: hydrateNode, parent: hydrateParent, end: hydrateEnd },
    depth: cursorStack.length,
    anchor,
  };
  hydrateNode = start;
  hydrateParent = anchor.parentNode;
  hydrateEnd = anchor;
  return walk;
}

/**
 * Return the walker to the range's own level after rendering one branch or
 * row. A root element the renderer returned (rather than appended) was
 * entered and never exited; its saved frame holds the cursor past it.
 */
export function settleRange(walk: RangeWalk): void {
  if (cursorStack.length > walk.depth) {
    const frame = cursorStack[walk.depth]!;
    cursorStack.length = walk.depth;
    hydrateNode = frame.node;
    hydrateParent = frame.parent;
    hydrateEnd = frame.end;
  }
}

/**
 * Finish a range: remove the server nodes nothing claimed (the client
 * rendered fewer rows, or a different branch), then restore the walker.
 */
export function endRange(walk: RangeWalk): void {
  settleRange(walk);
  let node = hydrateNode;
  while (node && node !== walk.anchor) {
    const next = node.nextSibling;
    node.parentNode?.removeChild(node);
    node = next;
  }
  hydrateNode = walk.saved.node;
  hydrateParent = walk.saved.parent;
  hydrateEnd = walk.saved.end;
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
  hydrateParent = el;
  hydrateEnd = null;

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
    hydrateParent = null;
    hydrateEnd = null;
    cursorStack.length = 0;
  }
}
