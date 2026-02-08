// ============================================================================
// @utopia/router — Router components (render functions)
// ============================================================================
//
// These are vanilla DOM render functions since we don't have compiled Utopia
// components available at the router package level. They integrate with the
// reactive signals from the router to swap components on navigation.
//
// ============================================================================

import { effect } from '@utopia/core';
import { currentRoute, navigate } from './router.js';
import type { RouteMatch } from './types.js';

// ---------------------------------------------------------------------------
// RouterView — Renders the current route's component
// ---------------------------------------------------------------------------

/**
 * Creates a DOM node that renders the current route's component.
 *
 * When the route changes:
 * 1. The old component is unmounted (removed from DOM)
 * 2. The new component is lazily loaded
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

  effect(() => {
    const match = currentRoute();

    // If the same route instance, skip update (avoids unnecessary re-renders).
    if (match === currentMatch) {
      return;
    }
    currentMatch = match;

    // Clean up previous component.
    if (currentCleanup) {
      currentCleanup();
      currentCleanup = null;
    }

    // Clear the container.
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (!match) {
      // No matching route — render nothing (or a 404 placeholder).
      const notFound = document.createElement('div');
      notFound.setAttribute('data-utopia-not-found', '');
      notFound.textContent = 'Page not found';
      container.appendChild(notFound);
      return;
    }

    // Load the route component (and layout/error if present).
    loadRouteComponent(match, container).then((cleanupFn) => {
      currentCleanup = cleanupFn;
    });
  });

  return container;
}

/**
 * Load and mount a route's component, optionally wrapping in a layout.
 *
 * @returns A cleanup function to unmount the component
 */
async function loadRouteComponent(
  match: RouteMatch,
  container: HTMLElement,
): Promise<(() => void) | null> {
  try {
    // Load component module(s) in parallel.
    const promises: Promise<any>[] = [match.route.component()];
    if (match.route.layout) {
      promises.push(match.route.layout());
    }

    const modules = await Promise.all(promises);
    const pageModule = modules[0];
    const layoutModule = modules.length > 1 ? modules[1] : null;

    // Check if the route has changed while we were loading.
    // If so, don't mount — the new route's loader will handle it.
    if (currentRoute.peek() !== match) {
      return null;
    }

    // Extract the default export (the component function or class).
    const PageComponent = pageModule.default ?? pageModule;
    const LayoutComponent = layoutModule
      ? (layoutModule.default ?? layoutModule)
      : null;

    // Clear container before mounting (in case another load snuck in).
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Render the page component.
    const pageNode = renderComponent(PageComponent, {
      params: match.params,
      url: match.url,
    });

    if (LayoutComponent) {
      // Render layout with the page as a child slot.
      const layoutNode = renderComponent(LayoutComponent, {
        params: match.params,
        url: match.url,
        children: pageNode,
      });
      container.appendChild(layoutNode);
    } else {
      container.appendChild(pageNode);
    }

    return () => {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  } catch (err) {
    // Loading failed — try to show an error component.
    if (match.route.error) {
      try {
        const errorModule = await match.route.error();
        const ErrorComponent = errorModule.default ?? errorModule;
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        const errorNode = renderComponent(ErrorComponent, {
          error: err,
          params: match.params,
          url: match.url,
        });
        container.appendChild(errorNode);
      } catch {
        // Error component also failed — show fallback.
        renderFallbackError(container, err);
      }
    } else {
      renderFallbackError(container, err);
    }

    return () => {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
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
function renderComponent(component: any, props: Record<string, any>): Node {
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
  if (component && typeof component.render === 'function') {
    return component.render(props);
  }

  // Fallback: empty div.
  const div = document.createElement('div');
  div.textContent = '[Component render error]';
  return div;
}

/**
 * Render a fallback error message when no error component is available.
 */
function renderFallbackError(container: HTMLElement, error: unknown): void {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
  const errorDiv = document.createElement('div');
  errorDiv.setAttribute('data-utopia-error', '');
  errorDiv.style.cssText = 'padding:2rem;color:#dc2626;font-family:monospace;';
  errorDiv.innerHTML = `
    <h2 style="margin:0 0 1rem">Route Error</h2>
    <pre style="white-space:pre-wrap;word-break:break-word;">${escapeHtml(
      error instanceof Error ? error.message : String(error),
    )}</pre>
  `;
  container.appendChild(errorDiv);
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
    effect(() => {
      const match = currentRoute();
      const isActive = match
        ? match.url.pathname === props.href ||
          match.url.pathname.startsWith(props.href + '/')
        : false;

      if (isActive) {
        anchor.classList.add(props.activeClass!);
      } else {
        anchor.classList.remove(props.activeClass!);
      }
    });
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

/** Escape HTML entities to prevent XSS in error messages. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
