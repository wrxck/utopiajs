// ============================================================================
// @matthesketh/utopia-router — Route type definitions
// ============================================================================

/**
 * A compiled route entry in the route table.
 *
 * Routes are built at compile time from the file system manifest and stored
 * as an array. At runtime, incoming URLs are matched against `pattern`.
 */
export interface Route {
  /** URL pattern like '/users/:id' or '/blog/:slug'. */
  path: string;

  /** Compiled regex for matching incoming URLs against this route. */
  pattern: RegExp;

  /** Parameter names extracted from the path (e.g., ['id'] for '/users/:id'). */
  params: string[];

  /** Lazy component import — called only when the route is matched. */
  component: () => Promise<Record<string, unknown>>;

  /** Optional layout component that wraps the page. */
  layout?: () => Promise<Record<string, unknown>>;

  /** Optional error boundary component shown when loading fails. */
  error?: () => Promise<Record<string, unknown>>;

  /** Optional metadata (e.g. page title, auth requirements). */
  meta?: Record<string, unknown>;
}

/**
 * The result of successfully matching a URL against a route.
 */
export interface RouteMatch {
  /** The matched route entry. */
  route: Route;

  /** Extracted parameter values keyed by parameter name. */
  params: Record<string, string>;

  /** The full URL that was matched. */
  url: URL;
}

/**
 * Observable router state exposed as signals.
 */
export interface RouterState {
  /** The currently matched route, or null if no route matches. */
  current: RouteMatch | null;

  /** Whether a navigation is currently in progress. */
  navigating: boolean;
}

/**
 * Callback signature for beforeNavigate hooks (navigation guards).
 *
 * Return `false` to cancel the navigation, or `void`/`true` to allow it.
 * Returning a string redirects to that URL instead.
 */
export type BeforeNavigateHook = (
  from: RouteMatch | null,
  to: RouteMatch | null,
) => boolean | string | void | Promise<boolean | string | void>;
