// ============================================================================
// @matthesketh/utopia-router — Public API
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { Route, RouteConfig, RouteMatch, RouterState, BeforeNavigateHook } from './types';

// ---------------------------------------------------------------------------
// Route matching (build-time + runtime)
// ---------------------------------------------------------------------------

export { filePathToRoute, compilePattern, matchRoute, buildRouteTable } from './matcher';

// ---------------------------------------------------------------------------
// Client-side router
// ---------------------------------------------------------------------------

export {
  currentRoute,
  isNavigating,
  createRouter,
  navigate,
  back,
  forward,
  beforeNavigate,
  destroy,
} from './router';

// ---------------------------------------------------------------------------
// Router components (render functions)
// ---------------------------------------------------------------------------

export { createRouterView, createLink, preloadRoute } from './components';

// ---------------------------------------------------------------------------
// Query & route parameter utilities
// ---------------------------------------------------------------------------

export { queryParams, getQueryParam, setQueryParam, setQueryParams, getRouteParam } from './query';
