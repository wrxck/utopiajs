// ============================================================================
// @matthesketh/utopia-router — Router components (render functions)
// ============================================================================
//
// These are vanilla DOM render functions since we don't have compiled Utopia
// components available at the router package level. They integrate with the
// reactive signals from the router to swap components on navigation.
//
// ============================================================================

import { effect } from '@matthesketh/utopia-core';
import { currentRoute, navigate } from './router.js';
import type { RouteMatch } from './types.js';

// ---------------------------------------------------------------------------
// Pre-load cache — enables synchronous initial render
// ---------------------------------------------------------------------------

type ModuleImporter = () => Promise<Record<string, unknown>>;

/** Cache for pre-loaded route modules. Keyed by the importer function ref. */
const moduleCache = new Map<ModuleImporter, Record<string, unknown>>();

/**
 * Pre-load the current route's component (and layout) so that
 * `createRouterView()` can render it synchronously on first paint.
 *
 * Call this **after** `createRouter()` and **before** `mount()`.
 *
 * @example
 * ```ts
 * createRouter(routes)
 * await preloadRoute()
 * mount(App, '#app')
 * ```
 */
export async function preloadRoute(): Promise<void> {
  const match = currentRoute.peek();
  if (!match) return;

  const promises: Promise<Record<string, unknown>>[] = [match.route.component()];
  if (match.route.layout) {
    promises.push(match.route.layout());
  }

  const modules = await Promise.all(promises);
  moduleCache.set(match.route.component, modules[0]);
  if (match.route.layout && modules.length > 1) {
    moduleCache.set(match.route.layout, modules[1]);
  }
}

// ---------------------------------------------------------------------------
// RouterView — Renders the current route's component
// ---------------------------------------------------------------------------

/**
 * Creates a DOM node that renders the current route's component.
 *
 * When the route changes:
 * 1. The new component is lazily loaded (old content stays visible)
 * 2. Once loaded, the old component is swapped out atomically
 * 3. If the route has a layout, the page is wrapped in the layout
 * 4. If loading fails and an error component exists, it is shown instead
 *
 * @returns A container DOM node that manages route component lifecycle
 *
 * @example
 * ```ts
 * const view = createRouterView();
 * document.getElementById('app')!.appendChild(view);
 * ```
 */
export function createRouterView(): Node {
  const container = document.createElement('div');
  container.setAttribute('data-utopia-router-view', '');

  let currentCleanup: (() => void) | null = null;
  let currentMatch: RouteMatch | null = null;

  // Monotonically increasing ID to invalidate stale async loads.
  let loadId = 0;

  // ---- Synchronous initial render from pre-loaded cache ----
  const initialMatch = currentRoute.peek();
  if (initialMatch) {
    const syncResult = tryRenderFromCache(initialMatch);
    if (syncResult) {
      container.appendChild(syncResult.node);
      currentCleanup = syncResult.cleanup;
      currentMatch = initialMatch;
    }
  }

  effect(() => {
    const match = currentRoute();

    // If the same route instance, skip update (avoids unnecessary re-renders).
    if (match === currentMatch) {
      return;
    }
    currentMatch = match;

    // Increment load ID so any in-flight load from a previous navigation
    // will bail out when it completes.
    const thisLoadId = ++loadId;

    if (!match) {
      // No matching route — clean up old content and show 404.
      if (currentCleanup) {
        currentCleanup();
        currentCleanup = null;
      }
      clearContainer(container);
      const notFound = document.createElement('div');
      notFound.setAttribute('data-utopia-not-found', '');
      notFound.textContent = 'Page not found';
      container.appendChild(notFound);
      return;
    }

    // Load the route component (and layout/error if present).
    // The old content remains visible during loading to prevent flicker.
    loadRouteComponent(match).then((result) => {
      // If a newer navigation happened while we were loading, discard.
      if (thisLoadId !== loadId) return;
      if (!result) return;

      // Atomic swap: clean up old content, mount new content.
      if (currentCleanup) {
        currentCleanup();
        currentCleanup = null;
      }
      clearContainer(container);
      container.appendChild(result.node);
      currentCleanup = result.cleanup;
    });
  });

  return container;
}

/** Result of loading a route component, ready for mounting. */
interface LoadResult {
  node: Node;
  cleanup: () => void;
}

/**
 * Attempt to render a route synchronously from the pre-load cache.
 * Returns null if the route's modules are not cached.
 */
function tryRenderFromCache(match: RouteMatch): LoadResult | null {
  const cachedPage = moduleCache.get(match.route.component);
  if (!cachedPage) return null;

  if (match.route.layout && !moduleCache.has(match.route.layout)) return null;

  const cachedLayout = match.route.layout ? moduleCache.get(match.route.layout)! : null;

  // Consume the cache entries (one-time use).
  moduleCache.delete(match.route.component);
  if (match.route.layout) moduleCache.delete(match.route.layout);

  const PageComponent = cachedPage.default ?? cachedPage;
  const LayoutComponent = cachedLayout ? (cachedLayout.default ?? cachedLayout) : null;

  const pageNode = renderComponent(PageComponent, {
    params: match.params,
    url: match.url,
  });

  let node: Node;
  if (LayoutComponent) {
    node = renderComponent(LayoutComponent, {
      params: match.params,
      url: match.url,
      children: pageNode,
    });
  } else {
    node = pageNode;
  }

  return {
    node,
    cleanup: () => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    },
  };
}

/**
 * Load a route's component (and optional layout), rendering them off-DOM.
 *
 * Returns the rendered node and a cleanup function. Does NOT touch the
 * container — the caller handles the swap so old content stays visible
 * during the async load.
 *
 * @returns A LoadResult, or null if the route changed while loading
 */
async function loadRouteComponent(match: RouteMatch): Promise<LoadResult | null> {
  try {
    // Check the pre-load cache first.
    const cachedPage = moduleCache.get(match.route.component);
    const cachedLayout = match.route.layout ? moduleCache.get(match.route.layout) : undefined;

    let pageModule: Record<string, unknown>;
    let layoutModule: Record<string, unknown> | null = null;

    if (cachedPage) {
      pageModule = cachedPage;
      layoutModule = cachedLayout ?? null;
      moduleCache.delete(match.route.component);
      if (match.route.layout) moduleCache.delete(match.route.layout);
    } else {
      // Load component module(s) in parallel.
      const promises: Promise<Record<string, unknown>>[] = [match.route.component()];
      if (match.route.layout) {
        promises.push(match.route.layout());
      }
      const modules = await Promise.all(promises);
      pageModule = modules[0];
      layoutModule = modules.length > 1 ? modules[1] : null;
    }

    // Check if the route has changed while we were loading.
    // If so, don't mount — the new route's loader will handle it.
    if (currentRoute.peek() !== match) {
      return null;
    }

    // Extract the default export (the component function or class).
    const PageComponent = pageModule.default ?? pageModule;
    const LayoutComponent = layoutModule ? (layoutModule.default ?? layoutModule) : null;

    // Render the page component.
    const pageNode = renderComponent(PageComponent, {
      params: match.params,
      url: match.url,
    });

    let node: Node;
    if (LayoutComponent) {
      // Render layout with the page as a child slot.
      node = renderComponent(LayoutComponent, {
        params: match.params,
        url: match.url,
        children: pageNode,
      });
    } else {
      node = pageNode;
    }

    return {
      node,
      cleanup: () => {
        // Remove the node from DOM when cleaning up.
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  } catch (err) {
    // Loading failed — try to show an error component.
    if (match.route.error) {
      try {
        const errorModule = await match.route.error();
        const ErrorComponent = errorModule.default ?? errorModule;
        const errorNode = renderComponent(ErrorComponent, {
          error: err,
          params: match.params,
          url: match.url,
        });

        return {
          node: errorNode,
          cleanup: () => {
            if (errorNode.parentNode) {
              errorNode.parentNode.removeChild(errorNode);
            }
          },
        };
      } catch {
        // Error component also failed — show fallback.
        return {
          node: createFallbackErrorNode(err),
          cleanup: () => {},
        };
      }
    } else {
      return {
        node: createFallbackErrorNode(err),
        cleanup: () => {},
      };
    }
  }
}

/**
 * Render a component, handling both function components and objects with a
 * render method.
 *
 * Function components are expected to return a DOM Node when called with
 * props. This is consistent with how the UtopiaJS compiler generates
 * component code.
 */
interface ComponentLike {
  render?: (props: Record<string, unknown>) => Node;
}

function renderComponent(component: unknown, props: Record<string, unknown>): Node {
  if (typeof component === 'function') {
    const result = component(props);
    if (result instanceof Node) {
      return result;
    }
    // If the component returns a string, wrap it in a text node.
    if (typeof result === 'string') {
      return document.createTextNode(result);
    }
    // If it has a render method (class-like component).
    if (result && typeof result.render === 'function') {
      return result.render();
    }
  }
  // Object with render method.
  if (component && typeof (component as ComponentLike).render === 'function') {
    return (component as ComponentLike).render!(props);
  }

  // Fallback: empty div.
  const div = document.createElement('div');
  div.textContent = '[Component render error]';
  return div;
}

/**
 * Create a fallback error DOM node when no error component is available.
 */
function createFallbackErrorNode(error: unknown): Node {
  const errorDiv = document.createElement('div');
  errorDiv.setAttribute('data-utopia-error', '');
  errorDiv.style.cssText = 'padding:2rem;color:#dc2626;font-family:monospace;';
  errorDiv.innerHTML = `
    <h2 style="margin:0 0 1rem">Route Error</h2>
    <pre style="white-space:pre-wrap;word-break:break-word;">${escapeHtml(
      error instanceof Error ? error.message : String(error),
    )}</pre>
  `;
  return errorDiv;
}

// ---------------------------------------------------------------------------
// Link — Navigation link component
// ---------------------------------------------------------------------------

/**
 * Creates an anchor element that performs client-side navigation when clicked.
 *
 * The link integrates with the router's click interception, but also sets up
 * the correct `href` and can apply active-state CSS classes.
 *
 * @param props - Link properties
 * @param props.href - The URL to navigate to
 * @param props.children - Child node(s) to render inside the anchor
 * @param props.class - Optional CSS class name
 * @param props.activeClass - Optional CSS class applied when the link's href matches the current route
 * @returns An HTMLAnchorElement
 *
 * @example
 * ```ts
 * const link = createLink({
 *   href: '/about',
 *   children: document.createTextNode('About'),
 * });
 * document.body.appendChild(link);
 * ```
 */
export function createLink(props: {
  href: string;
  children: Node | string;
  class?: string;
  activeClass?: string;
}): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = props.href;

  if (props.class) {
    anchor.className = props.class;
  }

  // Append children.
  if (typeof props.children === 'string') {
    anchor.textContent = props.children;
  } else {
    anchor.appendChild(props.children);
  }

  // Track active state if activeClass is provided.
  if (props.activeClass) {
    const dispose = effect(() => {
      const match = currentRoute();
      const isActive = match
        ? match.url.pathname === props.href || match.url.pathname.startsWith(props.href + '/')
        : false;

      if (isActive) {
        anchor.classList.add(props.activeClass!);
      } else {
        anchor.classList.remove(props.activeClass!);
      }
    });
    // Attach cleanup for when link is removed
    (anchor as unknown as { __dispose?: () => void }).__dispose = dispose;
  }

  // The actual navigation is handled by the router's global click
  // interceptor set up in createRouter(). We don't add a click handler
  // here because the router already intercepts <a> clicks with href
  // starting with '/'. This avoids double-navigation.

  return anchor;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove all child nodes from a container. */
function clearContainer(container: HTMLElement): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

export const AMPERSAND_RE = /&/g;
export const LESS_THAN_RE = /</g;
export const GREATER_THAN_RE = />/g;
export const DOUBLE_QUOTE_RE = /"/g;
export const SINGLE_QUOTE_RE = /'/g;

/** Escape HTML entities to prevent XSS in error messages. */
function escapeHtml(str: string): string {
  return str
    .replace(AMPERSAND_RE, '&amp;')
    .replace(LESS_THAN_RE, '&lt;')
    .replace(GREATER_THAN_RE, '&gt;')
    .replace(DOUBLE_QUOTE_RE, '&quot;')
    .replace(SINGLE_QUOTE_RE, '&#x27;');
}
