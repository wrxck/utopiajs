// ============================================================================
// @matthesketh/utopia-runtime — Lazy components / Code splitting
// ============================================================================
//
// defineLazy() creates a component definition that loads a module dynamically.
// Shows an optional fallback during loading, then swaps in the real component.
// ============================================================================

import { type ComponentDefinition, pushDisposer } from '@/component';
import { createComponent } from '@/directives';
import { createElement } from '@/dom';
import { isHydrating } from '@/hydration';

/** Context key carrying a lazy component's props from setup to render. */
const LAZY_PROPS = '$lazyProps';

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
    // pass the props through setup so render can forward them. a render-only
    // definition receives just `{ $slots }` — the props given to the lazy
    // component never reached the component it loads.
    setup(props: Record<string, unknown>) {
      return { [LAZY_PROPS]: props };
    },
    render(ctx: Record<string, unknown>) {
      const props = (ctx[LAZY_PROPS] as Record<string, unknown> | undefined) ?? {};
      const slots = ctx.$slots as Record<string, () => Node> | undefined;

      // Check cache first. While hydrating, the server markup is the
      // container with the fallback in it (a server render cannot wait for the
      // module), so even a cached module goes through the container and swaps
      // in once hydration has finished.
      const cached = moduleCache.get(loader);
      if (cached && !isHydrating) {
        return createComponent(cached, props, slots);
      }

      // create a container for the swap. createElement claims the server's
      // container while hydrating; a plain document.createElement left it
      // detached, so the component never appeared on a hydrated page.
      const container = createElement('div') as HTMLElement;
      container.setAttribute('data-utopia-lazy', '');

      // the real component mounts asynchronously, outside any disposer-capture
      // scope, so capture its cleanup here and forward it to the surrounding
      // scope — otherwise the lazy component's effects + onDestroy leaked on
      // unmount.
      let innerCleanup: (() => void) | undefined;
      let disposed = false;
      pushDisposer(() => {
        disposed = true;
        innerCleanup?.();
      });

      // show fallback while loading. a hydrating container already holds the
      // server-rendered fallback, and it is replaced when the module arrives.
      if (fallback && !isHydrating) {
        const fallbackNode = fallback();
        container.appendChild(fallbackNode);
      }

      // Reuse in-flight promise if one exists (dedup).
      let loadPromise = cached ? Promise.resolve({ default: cached }) : pendingLoads.get(loader);
      if (!loadPromise) {
        loadPromise = loader();
        pendingLoads.set(loader, loadPromise);
      }

      loadPromise
        .then((mod) => {
          const Component = mod.default;
          moduleCache.set(loader, Component);
          pendingLoads.delete(loader);

          // the surrounding scope was torn down while the module loaded (the
          // user navigated away). the detached container still has a parent
          // inside the discarded subtree, so that check alone mounted the
          // component anyway — with nothing left to ever dispose it.
          if (disposed || !container.parentNode) return;

          // clear fallback and mount real component.
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
          const node = createComponent(Component, props, slots);
          innerCleanup = (node as { __cleanup?: () => void }).__cleanup;
          container.appendChild(node);
        })
        .catch((err) => {
          pendingLoads.delete(loader);
          console.error('Failed to load lazy component:', err);

          if (disposed || !container.parentNode) return;

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
