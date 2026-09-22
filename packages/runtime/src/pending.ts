/**
 * @matthesketh/utopia-runtime — first renders waiting for their anchor
 *
 * A `u-if` / `u-for` anchor that is a component's root (or a branch returned
 * into an outer directive) is created before anything has inserted it, so its
 * directive cannot render yet. The runtime's insertion paths call
 * `runAttached` on what they insert, which renders such a directive the moment
 * its anchor lands. The directives also retry on a microtask, for insertions
 * made through the raw DOM API.
 *
 * A single microtask used to be the only retry, and anything inserted later —
 * a route page the router mounts after loading it, a component mounted after
 * an await — rendered nothing for the life of the page.
 *
 * Dependency-free leaf, like fragment.ts: dom.ts and directives.ts both use it.
 */

import type { FragmentWithRoots } from '@/fragment';

const waiting = new WeakMap<Node, () => void>();

/** Run `render` once `anchor` has been inserted somewhere. */
export function deferUntilAttached(anchor: Node, render: () => void): void {
  waiting.set(anchor, render);
}

/** Whether a render is still waiting for `anchor` to be inserted. */
export function isDeferred(anchor: Node): boolean {
  return waiting.has(anchor);
}

/** Forget a waiting render (the directive rendered or was disposed). */
export function cancelDeferred(anchor: Node): void {
  waiting.delete(anchor);
}

/**
 * Run the waiting render for a node that was just inserted — or, for a
 * fragment (which empties on insertion), for each of its recorded roots.
 */
export function runAttached(node: Node): void {
  if (node.nodeType === 11) {
    const roots = (node as FragmentWithRoots).__roots;
    if (roots) for (const r of roots) runAttached(r);
    return;
  }
  const render = waiting.get(node);
  if (render && node.parentNode) {
    waiting.delete(node);
    render();
  }
}

// ---------------------------------------------------------------------------
// directive ranges
// ---------------------------------------------------------------------------

/**
 * The live nodes a u-if / u-for anchor owns, which sit before it. A list row
 * whose root is such an anchor (a component whose template root is a u-if)
 * occupies the whole range, and moving only the anchor left its branch
 * behind — rows came out, or were reordered into, the wrong order.
 */
const ranges = new WeakMap<Node, () => Node[]>();

/** Record how to read the nodes `anchor` owns. */
export function setRange(anchor: Node, nodes: () => Node[]): void {
  ranges.set(anchor, nodes);
}

/**
 * Every node a row occupies, in document order: a directive anchor's range
 * (expanded recursively) followed by the anchor, or null for a plain node.
 */
export function rangeOf(node: Node): Node[] | null {
  const read = ranges.get(node);
  if (!read) return null;
  const out: Node[] = [];
  for (const n of read()) {
    const inner = n.nodeType === 11 ? ((n as FragmentWithRoots).__roots ?? []) : [n];
    for (const m of inner) {
      const nested = rangeOf(m);
      if (nested) out.push(...nested);
      else out.push(m);
    }
  }
  out.push(node);
  return out;
}
