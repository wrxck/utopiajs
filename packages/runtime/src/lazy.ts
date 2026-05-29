// ============================================================================
// @matthesketh/utopia-runtime — Lazy components / Code splitting
// ============================================================================
//
// defineLazy() creates a component definition that loads a module dynamically.
// Shows an optional fallback during loading, then swaps in the real component.
// ============================================================================

import { pushDisposer, type ComponentDefinition } from './component';
import { createComponent } from './directives';

/** Cache for loaded modules, keyed by loader function. */
const moduleCache = new Map<() => Promise<{ default: ComponentDefinition }>, ComponentDefinition>();

/** In-flight loads, keyed by loader function (prevents duplicate requests). */
const pendingLoads = new Map<
  () => Promise<{ default: ComponentDefinition }>,
  Promise<{ default: ComponentDefinition }>
>();

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

      // create a container for the swap.
      const container = document.createElement('div');
      container.setAttribute('data-utopia-lazy', '');

      // the real component mounts asynchronously, outside any disposer-capture
      // scope, so capture its cleanup here and forward it to the surrounding
      // scope — otherwise the lazy component's effects + onDestroy leaked on
      // unmount.
      let innerCleanup: (() => void) | undefined;
      pushDisposer(() => innerCleanup?.());

      // show fallback while loading.
      if (fallback) {
        const fallbackNode = fallback();
        container.appendChild(fallbackNode);
      }

      // Reuse in-flight promise if one exists (dedup).
      let loadPromise = pendingLoads.get(loader);
      if (!loadPromise) {
        loadPromise = loader();
        pendingLoads.set(loader, loadPromise);
      }

      loadPromise
        .then((mod) => {
          const Component = mod.default;
          moduleCache.set(loader, Component);
          pendingLoads.delete(loader);

          // Don't mutate if container has been detached from the DOM.
          if (!container.parentNode) return;

          // clear fallback and mount real component.
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
          const node = createComponent(Component, ctx);
          innerCleanup = (node as { __cleanup?: () => void }).__cleanup;
          container.appendChild(node);
        })
        .catch((err) => {
          pendingLoads.delete(loader);
          console.error('Failed to load lazy component:', err);

          // Don't mutate if container has been detached from the DOM.
          if (!container.parentNode) return;

          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
          const errorNode = document.createElement('span');
          errorNode.textContent = 'Failed to load component';
          container.appendChild(errorNode);
        });

      return container;
    },
  };
}
