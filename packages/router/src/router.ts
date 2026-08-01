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

import { matchRoute } from '@/matcher';
import { compilePattern } from '@/matcher';
import type { BeforeNavigateHook, Route, RouteConfig, RouteMatch } from '@/types';

// ---------------------------------------------------------------------------
// Regex constants
// ---------------------------------------------------------------------------

/** Validates that a hash fragment is a safe DOM id (alphanumeric, hyphens, underscores). */
export const VALID_DOM_ID_RE = /^[A-Za-z0-9_-]+$/;

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

/** Maximum number of scroll position entries to retain. */
const MAX_SCROLL_ENTRIES = 50;

/** Maximum depth of guard-driven redirects within a single navigation. */
const MAX_REDIRECT_DEPTH = 10;

/** Current redirect depth -- used to detect infinite redirect loops. */
let redirectDepth = 0;

/** The cleanup function to tear down event listeners. */
let cleanup: (() => void) | null = null;

// ---------------------------------------------------------------------------
// createRouter — Initialize the router
// ---------------------------------------------------------------------------

/**
 * Initialize the router with a route table.
 *
 * Accepts either compiled routes (with `pattern` and `params`) or simple
 * route configs (with just `path` and `component`). Simple configs are
 * compiled automatically.
 *
 * This must be called once at application startup. It:
 * 1. Stores the route table
 * 2. Matches the current URL and sets `currentRoute`
 * 3. Sets up popstate listener for browser back/forward
 * 4. Sets up click listener for <a> interception
 *
 * @param routeTable - Array of routes or route configs
 */
export function createRouter(routeTable: (Route | RouteConfig)[]): void {
  // Tear down any previous router instance (useful for HMR / tests).
  if (cleanup) {
    cleanup();
  }

  // Compile routes that don't have a pattern yet.
  routes = routeTable.map((r) => {
    if ('pattern' in r && r.pattern instanceof RegExp) {
      return r as Route;
    }
    const { regex, params } = compilePattern(r.path);
    return { ...r, pattern: regex, params };
  });
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

    // If the initial URL has a hash fragment, scroll to the target element.
    // Use a higher attempt count for initial load since the route component
    // must be fetched over the network before rendering.
    if (url.hash) {
      scrollToHash(url.hash.slice(1), 60);
    }
  }

  // Set up event listeners.
  if (typeof window !== 'undefined') {
    const handlePopState = (event: PopStateEvent): void => {
      const state = event.state;
      const targetIndex = state?._utopiaNavIndex ?? 0;

      // Save current scroll position before navigating.
      saveScrollPosition();
      navIndex = targetIndex;

      const url = new URL(window.location.href);
      const match = matchRoute(url, routes);

      // Run beforeNavigate hooks (synchronous for popstate — async hooks
      // that return promises will be awaited, but we cannot cancel browser
      // back/forward; we can only skip updating the route).
      runBeforeNavigateHooks(currentRoute.peek(), match).then((result) => {
        if (result === false) {
          // Guard rejected -- restore the previous URL.
          const prev = currentRoute.peek();
          if (prev) {
            history.pushState(
              { _utopiaNavIndex: navIndex },
              '',
              prev.url.pathname + prev.url.search + prev.url.hash,
            );
          }
          return;
        }

        if (typeof result === 'string') {
          // A redirect computed during back/forward must not send the user
          // cross-origin (e.g. a guard reading an attacker-controlled returnTo).
          if (!isSafeRedirectTarget(result)) {
            console.error('[utopia] Cross-origin redirect blocked:', result);
            return;
          }
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

      const href = anchor.getAttribute('href');
      if (!href) return;

      // Hash-only links on the same page: scroll to the target element
      // without triggering a route change. We handle this ourselves rather
      // than relying on native browser behavior because the target element
      // may have been dynamically injected (e.g. via u-html).
      if (href.startsWith('#')) {
        event.preventDefault();
        const hashId = href.slice(1);
        if (hashId) {
          history.pushState(
            { _utopiaNavIndex: ++navIndex },
            '',
            window.location.pathname + window.location.search + href,
          );
          scrollToHash(hashId);
        }
        return;
      }

      // skip external links and non-HTTP protocols. a protocol-relative href
      // (`//evil.com`) starts with `/` but is cross-origin, so exclude it first.
      if (href.startsWith('//')) return;
      if (!href.startsWith('/') && !isSameOriginAbsoluteUrl(href)) return;

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
export async function navigate(url: string, options: { replace?: boolean } = {}): Promise<void> {
  if (typeof window === 'undefined') return;

  redirectDepth++;
  if (redirectDepth > MAX_REDIRECT_DEPTH) {
    console.error('[utopia] Maximum navigation redirects exceeded');
    // Undo only this frame's increment: the callers unwinding beneath us each
    // decrement their own in `finally`, restoring the counter to its baseline.
    // (Resetting to 0 here drove the counter negative as the stack unwound,
    // weakening the loop guard on every subsequent redirect loop.)
    redirectDepth--;
    return;
  }

  isNavigating.set(true);

  try {
    // Parse the URL.
    const fullUrl = new URL(url, window.location.origin);
    const currentUrl = new URL(window.location.href);

    // Same-page hash navigation: path and search are identical, only hash differs.
    // Update the URL and scroll to the element without triggering a route change.
    if (
      fullUrl.pathname === currentUrl.pathname &&
      fullUrl.search === currentUrl.search &&
      fullUrl.hash
    ) {
      saveScrollPosition();
      navIndex++;
      const state = { _utopiaNavIndex: navIndex };
      if (options.replace) {
        history.replaceState(state, '', fullUrl.href);
      } else {
        history.pushState(state, '', fullUrl.href);
      }
      scrollToHash(fullUrl.hash.slice(1));
      return;
    }

    const match = matchRoute(fullUrl, routes);

    // Run beforeNavigate hooks.
    const hookResult = await runBeforeNavigateHooks(currentRoute.peek(), match);

    if (hookResult === false) {
      // Navigation cancelled by guard.
      return;
    }

    if (typeof hookResult === 'string') {
      // Only allow same-origin redirects. Unparseable targets are blocked too;
      // letting them through would make the nested navigate() reject.
      if (!isSafeRedirectTarget(hookResult)) {
        console.error('[utopia] Cross-origin redirect blocked:', hookResult);
        return;
      }
      // Redirect -- navigate to the new URL instead.
      await navigate(hookResult, options);
      return;
    }

    // Save current scroll position.
    saveScrollPosition();

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

    // Scroll handling for forward navigation.
    if (fullUrl.hash) {
      // Cross-page hash navigation: the target element may not exist yet because
      // the route component loads asynchronously. Poll across multiple frames.
      scrollToHash(fullUrl.hash.slice(1));
    } else {
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  } finally {
    redirectDepth--;
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
 * Whether an href is an absolute URL on the current origin. A plain prefix
 * check is not sufficient: `https://example.com.evil.com` starts with
 * `https://example.com` yet is cross-origin.
 *
 * Relative or unparseable hrefs return false — they are not handled here.
 */
function isSameOriginAbsoluteUrl(href: string): boolean {
  try {
    return new URL(href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Same-origin check for guard-provided redirect targets (relative paths are
 * resolved against the current origin). Cross-origin and unparseable targets
 * are rejected.
 */
function isSafeRedirectTarget(target: string): boolean {
  try {
    return new URL(target, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
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
    try {
      const result = await hook(from, to);
      if (result === false) {
        return false;
      }
      if (typeof result === 'string') {
        return result;
      }
    } catch (err) {
      console.error('[utopia] Navigation guard error:', err);
    }
  }
  return undefined;
}

/**
 * Record the current scroll position under the current navigation index,
 * evicting the oldest entry if the map exceeds the size cap.
 */
function saveScrollPosition(): void {
  scrollPositions.set(navIndex, { x: window.scrollX, y: window.scrollY });
  if (scrollPositions.size > MAX_SCROLL_ENTRIES) {
    const firstKey = scrollPositions.keys().next().value;
    if (firstKey !== undefined) scrollPositions.delete(firstKey);
  }
}

/**
 * Scroll to an element identified by a hash fragment.
 *
 * The target element may not exist yet (e.g. route component loading
 * asynchronously), so we poll across multiple animation frames before
 * giving up.
 *
 * @param hashId - The element id (without the leading `#`)
 * @param maxAttempts - Maximum number of frames to poll (default 25 ≈ 400ms)
 */
function scrollToHash(hashId: string, maxAttempts = 25): void {
  if (!hashId || !VALID_DOM_ID_RE.test(hashId)) return;

  const attempt = (remaining: number) => {
    const el = document.getElementById(hashId);
    if (el) {
      el.scrollIntoView();
    } else if (remaining > 0) {
      requestAnimationFrame(() => attempt(remaining - 1));
    }
  };
  requestAnimationFrame(() => attempt(maxAttempts));
}
