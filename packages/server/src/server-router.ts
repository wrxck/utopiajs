// ============================================================================
// @utopia/server — Server-side router
// ============================================================================
//
// Matches a URL against the route table on the server. No History API,
// no event listeners, no scroll handling — just pure route matching.
// ============================================================================

import { matchRoute } from '@utopia/router';
import type { Route, RouteMatch } from '@utopia/router';

/**
 * Match a URL string against a route table on the server.
 *
 * @param routes - The compiled route table
 * @param url    - The URL string to match (e.g. '/blog/my-post')
 * @returns The matched route with params, or null
 */
export function createServerRouter(
  routes: Route[],
  url: string,
): RouteMatch | null {
  // Construct a full URL. On the server we don't have window.location,
  // so we use a dummy origin.
  const fullUrl = new URL(url, 'http://localhost');
  return matchRoute(fullUrl, routes);
}
