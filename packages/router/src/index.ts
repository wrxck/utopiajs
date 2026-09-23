// ============================================================================
// @matthesketh/utopia-router — Public API
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { BeforeNavigateHook, Route, RouteConfig, RouteMatch, RouterState } from '@/types';

// ---------------------------------------------------------------------------
// Route matching (build-time + runtime)
// ---------------------------------------------------------------------------

export {
  buildRouteTable,
  compareRouteSpecificity,
  compilePattern,
  filePathToRoute,
  matchRoute,
} from '@/matcher';

// ---------------------------------------------------------------------------
// Client-side router
// ---------------------------------------------------------------------------

export {
  back,
  beforeNavigate,
  createRouter,
  currentRoute,
  destroy,
  forward,
  isNavigating,
  navigate,
} from '@/router';

// ---------------------------------------------------------------------------
// Router components (render functions)
// ---------------------------------------------------------------------------

export { createLink, createRouterView, preloadRoute, withRoute } from '@/components';

// ---------------------------------------------------------------------------
// Query & route parameter utilities
// ---------------------------------------------------------------------------

export { getQueryParam, getRouteParam, queryParams, setQueryParam, setQueryParams } from '@/query';
