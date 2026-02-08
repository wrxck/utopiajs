// ============================================================================
// @matthesketh/utopia-router — Client-side History API router
// ============================================================================
//
// Provides SPA routing using the browser History API. Route state is exposed
// as reactive signals from @matthesketh/utopia-core so UI components automatically update
// when navigation occurs.
//
// Features:
//   - popstate listener for browser back/forward
//   - <a> click interception for client-side navigation
//   - Scroll position management (top on navigate, restore on back/forward)
//   - beforeNavigate hooks for navigation guards
//   - Programmatic navigate(), back(), forward()
//
// ============================================================================

import { signal } from '@matthesketh/utopia-core';
import { matchRoute } from './matcher.js';
import type { Route, RouteMatch, BeforeNavigateHook } from './types.js';

// ---------------------------------------------------------------------------
// Router state (reactive signals)
// ---------------------------------------------------------------------------

/** The currently matched route, or null if no route matches. */
export const currentRoute = signal<RouteMatch | null>(null);

/** Whether a navigation is currently in progress (loading component, etc.). */
export const isNavigating = signal(false);

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** The compiled route table, set by createRouter(). */
let routes: Route[] = [];

/** Registered beforeNavigate hooks. */
let beforeNavigateHooks: BeforeNavigateHook[] = [];

/**
 * Scroll position storage keyed by history state index.
 * Used to restore scroll position on popstate (back/forward).
 */
const scrollPositions: Map<number, { x: number; y: number }> = new Map();

/** Monotonically increasing navigation index for scroll position tracking. */
let navIndex = 0;

/** The cleanup function to tear down event listeners. */
let cleanup: (() => void) | null = null;

// ---------------------------------------------------------------------------
// createRouter — Initialize the router
// ---------------------------------------------------------------------------

/**
 * Initialize the router with a compiled route table.
 *
 * This must be called once at application startup. It:
 * 1. Stores the route table
 * 2. Matches the current URL and sets `currentRoute`
 * 3. Sets up popstate listener for browser back/forward
 * 4. Sets up click listener for <a> interception
 *
 * @param routeTable - Array of compiled routes from `buildRouteTable()`
 */
export function createRouter(routeTable: Route[]): void {
  // Tear down any previous router instance (useful for HMR / tests).
  if (cleanup) {
    cleanup();
  }

  routes = routeTable;
  beforeNavigateHooks = [];
  scrollPositions.clear();
  navIndex = 0;

  // Set initial history state with navigation index.
  if (typeof window !== 'undefined' && typeof history !== 'undefined') {
    history.replaceState({ _utopiaNavIndex: navIndex }, '');
  }

  // Match the current URL.
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    const match = matchRoute(url, routes);
    currentRoute.set(match);
  }

  // Set up event listeners.
  if (typeof window !== 'undefined') {
    const handlePopState = (event: PopStateEvent): void => {
      const state = event.state;
      const targetIndex = state?._utopiaNavIndex ?? 0;

      // Save current scroll position before navigating.
      scrollPositions.set(navIndex, { x: window.scrollX, y: window.scrollY });
      navIndex = targetIndex;

      const url = new URL(window.location.href);
      const match = matchRoute(url, routes);

      // Run beforeNavigate hooks (synchronous for popstate — async hooks
      // that return promises will be awaited, but we cannot cancel browser
      // back/forward; we can only skip updating the route).
      runBeforeNavigateHooks(currentRoute.peek(), match).then((result) => {
        if (result === false) {
          // Guard rejected — try to undo the navigation.
          // This is best-effort; the URL has already changed.
          return;
        }

        if (typeof result === 'string') {
          // Redirect.
          navigate(result, { replace: true });
          return;
        }

        currentRoute.set(match);

        // Restore scroll position if we have one saved.
        const savedPos = scrollPositions.get(targetIndex);
        if (savedPos) {
          requestAnimationFrame(() => {
            window.scrollTo(savedPos.x, savedPos.y);
          });
        }
      });
    };

    const handleClick = (event: MouseEvent): void => {
      // Only handle left-clicks without modifier keys.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.defaultPrevented) return;

      // Walk up from the event target to find an <a> element.
      const anchor = findAnchorElement(event.target as Element);
      if (!anchor) return;

      // Skip links with target or download attributes.
      if (anchor.hasAttribute('target') || anchor.hasAttribute('download')) return;

      // Skip external links and non-HTTP protocols.
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (!href.startsWith('/') && !href.startsWith(window.location.origin)) return;

      // Skip hash-only links on the same page.
      if (href.startsWith('#')) return;

      event.preventDefault();
      navigate(href);
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClick);

    cleanup = () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleClick);
      cleanup = null;
    };
  }
}

// ---------------------------------------------------------------------------
// navigate — Programmatic navigation
// ---------------------------------------------------------------------------

/**
 * Navigate to a new URL.
 *
 * @param url - The URL to navigate to (absolute path like '/about' or full URL)
 * @param options - Navigation options
 * @param options.replace - If true, replace the current history entry instead of pushing
 * @returns Promise that resolves when navigation is complete
 */
export async function navigate(
  url: string,
  options: { replace?: boolean } = {},
): Promise<void> {
  if (typeof window === 'undefined') return;

  isNavigating.set(true);

  try {
    // Parse the URL.
    const fullUrl = new URL(url, window.location.origin);
    const match = matchRoute(fullUrl, routes);

    // Run beforeNavigate hooks.
    const hookResult = await runBeforeNavigateHooks(currentRoute.peek(), match);

    if (hookResult === false) {
      // Navigation cancelled by guard.
      return;
    }

    if (typeof hookResult === 'string') {
      // Redirect — navigate to the new URL instead.
      await navigate(hookResult, options);
      return;
    }

    // Save current scroll position.
    scrollPositions.set(navIndex, { x: window.scrollX, y: window.scrollY });

    // Update history.
    navIndex++;
    const state = { _utopiaNavIndex: navIndex };

    if (options.replace) {
      history.replaceState(state, '', fullUrl.href);
    } else {
      history.pushState(state, '', fullUrl.href);
    }

    // Update the current route signal.
    currentRoute.set(match);

    // Scroll to top on forward navigation (not back/forward).
    requestAnimationFrame(() => {
      // If the URL has a hash, scroll to the element.
      if (fullUrl.hash) {
        const el = document.getElementById(fullUrl.hash.slice(1));
        if (el) {
          el.scrollIntoView();
          return;
        }
      }
      window.scrollTo(0, 0);
    });
  } finally {
    isNavigating.set(false);
  }
}

// ---------------------------------------------------------------------------
// back / forward — History navigation
// ---------------------------------------------------------------------------

/** Navigate back one entry in the browser history. */
export function back(): void {
  if (typeof window !== 'undefined') {
    history.back();
  }
}

/** Navigate forward one entry in the browser history. */
export function forward(): void {
  if (typeof window !== 'undefined') {
    history.forward();
  }
}

// ---------------------------------------------------------------------------
// beforeNavigate — Navigation guards
// ---------------------------------------------------------------------------

/**
 * Register a navigation guard that runs before each navigation.
 *
 * The hook receives the current and next route matches. It can:
 * - Return `void` or `true` to allow navigation
 * - Return `false` to cancel navigation
 * - Return a string to redirect to a different URL
 *
 * @param hook - The guard callback
 * @returns A function that removes the hook
 */
export function beforeNavigate(hook: BeforeNavigateHook): () => void {
  beforeNavigateHooks.push(hook);
  return () => {
    const idx = beforeNavigateHooks.indexOf(hook);
    if (idx !== -1) {
      beforeNavigateHooks.splice(idx, 1);
    }
  };
}

// ---------------------------------------------------------------------------
// destroy — Tear down the router
// ---------------------------------------------------------------------------

/**
 * Tear down the router, removing all event listeners and clearing state.
 * Primarily useful for testing and HMR.
 */
export function destroy(): void {
  if (cleanup) {
    cleanup();
  }
  routes = [];
  beforeNavigateHooks = [];
  scrollPositions.clear();
  navIndex = 0;
  currentRoute.set(null);
  isNavigating.set(false);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk up the DOM from a target element to find the nearest <a> ancestor.
 */
function findAnchorElement(target: Element | null): HTMLAnchorElement | null {
  while (target) {
    if (target.tagName === 'A') {
      return target as HTMLAnchorElement;
    }
    target = target.parentElement;
  }
  return null;
}

/**
 * Run all registered beforeNavigate hooks in order.
 *
 * @returns false if cancelled, a string if redirecting, or void/true if allowed
 */
async function runBeforeNavigateHooks(
  from: RouteMatch | null,
  to: RouteMatch | null,
): Promise<boolean | string | void> {
  for (const hook of beforeNavigateHooks) {
    const result = await hook(from, to);
    if (result === false) {
      return false;
    }
    if (typeof result === 'string') {
      return result;
    }
  }
  return undefined;
}
