// ============================================================================
// @matthesketh/utopia-router — Router components (render functions)
// ============================================================================
//
// These are vanilla DOM render functions since we don't have compiled Utopia
// components available at the router package level. They integrate with the
// reactive signals from the router to swap components on navigation.
//
// ============================================================================

import { createRoot, effect } from '@matthesketh/utopia-core';
import {
  popOwner,
  pushOwner,
  startCapturingDisposers,
  startCapturingLifecycle,
  stopCapturingDisposers,
  stopCapturingLifecycle,
} from '@matthesketh/utopia-runtime';

import { currentRoute } from '@/router';
import type { RouteMatch } from '@/types';

/** A DOM node with the runtime's optional teardown hook attached. */
interface DisposableNode extends Node {
  __cleanup?: () => void;
}

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
 * Creates a UtopiaJS-compatible component that renders the current route's
 * component. Can be used as `<RouterView />` in .utopia templates.
 *
 * When the route changes:
 * 1. The new component is lazily loaded (old content stays visible)
 * 2. Once loaded, the old component is swapped out atomically
 * 3. If the route has a layout, the page is wrapped in the layout
 * 4. If loading fails and an error component exists, it is shown instead
 *
 * @returns A component definition compatible with UtopiaJS's component system
 *
 * @example
 * ```ts
 * import { createRouterView as RouterView } from '@matthesketh/utopia-router';
 * // In template: <RouterView />
 * ```
 */
export function createRouterView(): { render: () => Node } {
  return { render: () => createRouterViewNode() };
}

/** Internal: creates the actual DOM node for the router view. */
function createRouterViewNode(): Node {
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
  } else {
    // The initial URL matches nothing — show the 404 immediately. (The
    // effect below skips its first run in this case, since the match is
    // still null.)
    showNotFound(container);
  }

  const dispose = effect(() => {
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
      showNotFound(container);
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

  // Attach cleanup so hosts can stop the effect when the view is removed
  // (same contract as createLink). Without this, every discarded view keeps
  // reloading route modules on each navigation for the rest of the app's life.
  (container as unknown as { __dispose?: () => void }).__dispose = dispose;

  return container;
}

/** Append the "Page not found" placeholder to the container. */
function showNotFound(container: HTMLElement): void {
  const notFound = document.createElement('div');
  notFound.setAttribute('data-utopia-not-found', '');
  notFound.textContent = 'Page not found';
  container.appendChild(notFound);
}

/** Result of loading a route component, ready for mounting. */
interface LoadResult {
  node: Node;
  cleanup: () => void;
}

/**
 * Wrap a rendered node in a LoadResult whose cleanup disposes the rendered
 * component's effects and runs its onDestroy hooks before detaching it from
 * the DOM. Without the `__cleanup` call a navigation leaks the outgoing page's
 * effects and computeds against the long-lived router signals.
 *
 * `inner` is the page node when it has been wrapped in a layout: only the outer
 * node is in the DOM, but both own effects, so both must be torn down.
 */
function toLoadResult(node: Node, inner?: Node): LoadResult {
  return {
    node,
    cleanup: () => {
      if (inner && inner !== node) {
        (inner as DisposableNode).__cleanup?.();
      }
      (node as DisposableNode).__cleanup?.();
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    },
  };
}

/**
 * Render a matched route's page module, wrapped in its layout module when one
 * is present (the page is passed to the layout as `children`).
 */
function renderMatch(
  match: RouteMatch,
  pageModule: Record<string, unknown>,
  layoutModule: Record<string, unknown> | null,
): LoadResult {
  // Extract the default export (the component function or class).
  const PageComponent = pageModule.default ?? pageModule;
  const pageNode = renderComponent(PageComponent, {
    params: match.params,
    url: match.url,
  });

  let node: Node = pageNode;
  if (layoutModule) {
    const LayoutComponent = layoutModule.default ?? layoutModule;
    node = renderComponent(LayoutComponent, {
      params: match.params,
      url: match.url,
      children: pageNode,
    });
  }

  return toLoadResult(node, pageNode);
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

  return renderMatch(match, cachedPage, cachedLayout);
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
    // Check the pre-load cache first (consuming any entries).
    let pageModule = moduleCache.get(match.route.component);
    let layoutModule: Record<string, unknown> | null = null;

    if (pageModule) {
      layoutModule = (match.route.layout && moduleCache.get(match.route.layout)) || null;
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

    return renderMatch(match, pageModule, layoutModule);
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
        return toLoadResult(errorNode);
      } catch {
        // Error component also failed — show fallback.
        return { node: createFallbackErrorNode(err), cleanup: () => {} };
      }
    }
    return { node: createFallbackErrorNode(err), cleanup: () => {} };
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

interface SetupComponent extends ComponentLike {
  setup?: (props: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Invoke a component definition's render, calling `setup(props)` first for
 * per-instance (`defineProps`) components so their render receives the setup
 * context instead of the raw props (which would otherwise crash, since the
 * compiled per-instance render reads `ctx.__render`).
 */
function invokeRender(component: unknown, props: Record<string, unknown>): Node {
  if (typeof component === 'function') {
    const result = component(props);
    if (result instanceof Node) return result;
    if (typeof result === 'string') return document.createTextNode(result);
    // a function that returned a definition object → render that.
    if (result && typeof (result as ComponentLike).render === 'function') {
      return invokeRender(result, props);
    }
  }

  const def = component as SetupComponent | null;
  if (def && typeof def.render === 'function') {
    // per-instance component: run setup() to build the render context.
    if (typeof def.setup === 'function') {
      const ctx = def.setup(props);
      return def.render({ ...ctx, $slots: {} } as Record<string, unknown>);
    }
    // module-scope component: render reads its script vars by closure; props
    // (params/url/children) are passed through for components that use them.
    return def.render(props);
  }

  // Fallback: empty div.
  const div = document.createElement('div');
  div.textContent = '[Component render error]';
  return div;
}

/**
 * Render a route component into a DOM node, capturing the reactive effects,
 * lifecycle hooks, and provide/inject owner created during `setup` + `render`.
 * The captured teardown is attached as `node.__cleanup` so navigating away
 * disposes the page's effects and runs its `onDestroy` hooks instead of leaking
 * them — and so `inject()` resolves against an owner during the page's setup.
 */
function renderComponent(component: unknown, props: Record<string, unknown>): Node {
  const owner = pushOwner();
  startCapturingLifecycle();
  const prev = startCapturingDisposers();
  let node: Node | undefined;
  let lifecycle: { mount: (() => void)[]; destroy: (() => void)[] };
  let rootDispose: () => void = () => {};
  try {
    // createRoot owns any raw computed()/effect() the page creates (e.g. via
    // getQueryParam) so they unsubscribe on navigation instead of leaking
    // against the long-lived router signals. child-component cleanups and
    // createEffect disposers are caught by the runtime capture above.
    createRoot((dispose) => {
      rootDispose = dispose;
      node = invokeRender(component, props);
    });
  } finally {
    lifecycle = stopCapturingLifecycle();
    const disposers = stopCapturingDisposers(prev);
    popOwner(owner);
    // node stays undefined only if invokeRender threw — in which case the
    // captured disposers are dropped with the failed render.
    if (node !== undefined) {
      let cleaned = false;
      (node as DisposableNode).__cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        for (const cb of lifecycle.destroy) {
          try {
            cb();
          } catch {
            /* a faulty onDestroy must not abort the rest of teardown */
          }
        }
        for (const d of disposers) {
          try {
            d();
          } catch {
            /* dispose path must not throw */
          }
        }
        rootDispose();
      };
    } else {
      // failed render — drop the root's captured reactivity immediately.
      rootDispose();
    }
  }
  // run onMount hooks now that the node exists (parity with createComponent,
  // which also fires onMount before the parent inserts the returned node).
  for (const cb of lifecycle.mount) {
    cb();
  }
  // node is always assigned here — invokeRender returns a node (or a fallback)
  // unless it threw, in which case createRoot rethrew and we never reach this.
  return node as Node;
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

/** Matches characters that must be entity-escaped in HTML. */
const HTML_SPECIAL_RE = /[&<>"']/g;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

/** Escape HTML entities to prevent XSS in error messages. */
function escapeHtml(str: string): string {
  return str.replace(HTML_SPECIAL_RE, (c) => HTML_ESCAPES[c]);
}
