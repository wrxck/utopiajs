// ============================================================================
// @matthesketh/utopia-runtime — Lazy components / Code splitting
// ============================================================================
//
// defineLazy() creates a component definition that loads a module dynamically.
// Shows an optional fallback during loading, then swaps in the real component.
// ============================================================================

import type { ComponentDefinition } from './component.js';
import { createComponent } from './directives.js';
import { removeNode } from './dom.js';

/** Cache for loaded modules, keyed by loader function. */
const moduleCache = new Map<() => Promise<{ default: ComponentDefinition }>, ComponentDefinition>();

/**
 * Define a lazy-loaded component.
 *
 * @param loader - Dynamic import function that returns a module with a default export.
 * @param fallback - Optional function that returns a DOM node shown while loading.
 * @returns A ComponentDefinition that can be used like any other component.
 */
export function defineLazy(
  loader: () => Promise<{ default: ComponentDefinition }>,
  fallback?: () => Node,
): ComponentDefinition {
  return {
    render(ctx: Record<string, unknown>) {
      // Check cache first.
      const cached = moduleCache.get(loader);
      if (cached) {
        return createComponent(cached, ctx);
      }

      // Create a container for the swap.
      const container = document.createElement('div');
      container.setAttribute('data-utopia-lazy', '');

      // Show fallback while loading.
      if (fallback) {
        const fallbackNode = fallback();
        container.appendChild(fallbackNode);
      }

      // Load the component asynchronously.
      loader().then((mod) => {
        const Component = mod.default;
        moduleCache.set(loader, Component);

        // Clear fallback and mount real component.
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        const node = createComponent(Component, ctx);
        container.appendChild(node);
      });

      return container;
    },
  };
}
