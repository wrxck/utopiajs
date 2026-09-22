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
