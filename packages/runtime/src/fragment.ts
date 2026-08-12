/**
 * @matthesketh/utopia-runtime — fragment root bookkeeping
 *
 * Inserting a DocumentFragment empties it, so anything that may need to
 * remove or re-mount a fragment-rooted subtree later must know which nodes
 * belonged to it. The insertion helpers snapshot the fragment's children
 * just before insertion; removal reclaims them back into the fragment,
 * which both detaches them from the live DOM and leaves the fragment ready
 * to mount again.
 *
 * Dependency-free on purpose: dom.ts already imports component.ts, and
 * component.ts needs these helpers too — a shared leaf module avoids the
 * cycle.
 */

/** DocumentFragment nodeType. */
export const FRAGMENT_TYPE = 11;

/** A DocumentFragment whose pre-insertion children have been recorded. */
export interface FragmentWithRoots extends DocumentFragment {
  __roots?: Node[];
}

/** Record a fragment's children just before insertion empties it. */
export function snapshotFragmentRoots(node: Node): void {
  if (node.nodeType === FRAGMENT_TYPE && node.childNodes.length > 0) {
    (node as FragmentWithRoots).__roots = Array.from(node.childNodes);
  }
}

/**
 * Detach a previously inserted fragment's recorded roots from the live DOM
 * by moving them back into the fragment. Returns false when the node is not
 * a fragment, so the caller falls through to normal single-node removal.
 */
export function reclaimFragment(node: Node): boolean {
  if (node.nodeType !== FRAGMENT_TYPE) return false;
  const roots = (node as FragmentWithRoots).__roots;
  if (roots) {
    for (const r of roots) {
      node.appendChild(r);
    }
  }
  return true;
}
