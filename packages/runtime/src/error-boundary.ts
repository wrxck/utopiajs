// ============================================================================
// @matthesketh/utopia-runtime — Error boundaries
// ============================================================================
//
// createErrorBoundary wraps a render function in a try/catch. On error it
// disposes any partially-created effects and renders a fallback UI.
// ============================================================================

import { signal } from '@matthesketh/utopia-core';
import { startCapturingDisposers, stopCapturingDisposers } from './component.js';
import { removeNode } from './dom.js';

/**
 * Create an error boundary that catches errors during rendering.
 *
 * @param tryFn - Function that renders the primary content.
 * @param catchFn - Function that renders a fallback given the caught error.
 * @returns The rendered DOM node (either from tryFn or catchFn).
 */
export function createErrorBoundary(tryFn: () => Node, catchFn: (error: Error) => Node): Node {
  const prev = startCapturingDisposers();

  try {
    const node = tryFn();
    const disposers = stopCapturingDisposers(prev);

    // Attach cleanup to the node for disposal on unmount.
    (node as any).__cleanup = () => {
      for (const dispose of disposers) {
        dispose();
      }
    };

    return node;
  } catch (err) {
    // Dispose any effects that were created before the error.
    const disposers = stopCapturingDisposers(prev);
    for (const dispose of disposers) {
      dispose();
    }

    const error = err instanceof Error ? err : new Error(String(err));
    return catchFn(error);
  }
}
