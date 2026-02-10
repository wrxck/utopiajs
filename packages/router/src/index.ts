// ============================================================================
// @matthesketh/utopia-router — Public API
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { Route, RouteMatch, RouterState, BeforeNavigateHook } from './types.js';

// ---------------------------------------------------------------------------
// Route matching (build-time + runtime)
// ---------------------------------------------------------------------------

export { filePathToRoute, compilePattern, matchRoute, buildRouteTable } from './matcher.js';

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
} from './router.js';

// ---------------------------------------------------------------------------
// Router components (render functions)
// ---------------------------------------------------------------------------

export { createRouterView, createLink } from './components.js';
