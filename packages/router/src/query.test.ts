// ============================================================================
// @matthesketh/utopia-router — Query & route parameter utility tests
// ============================================================================

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildRouteTable } from './matcher.js';
import { createRouter, currentRoute, navigate, destroy } from './router.js';
import { queryParams, getQueryParam, setQueryParam, setQueryParams, getRouteParam } from './query.js';
import type { Route } from './types.js';

// Helper to create a route table with a dynamic route.
const makeRoutes = (): Route[] => {
  return buildRouteTable({
    'src/routes/+page.utopia': () => Promise.resolve({ default: () => {} }),
    'src/routes/about/+page.utopia': () => Promise.resolve({ default: () => {} }),
    'src/routes/users/[id]/+page.utopia': () => Promise.resolve({ default: () => {} }),
  });
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  destroy();
});

// ============================================================================
// queryParams
// ============================================================================

describe('queryParams', () => {
  it('returns empty object when no query params', () => {
    createRouter(makeRoutes());
    expect(queryParams()).toEqual({});
  });

  it('returns correct object when URL has query params', () => {
    window.history.replaceState(null, '', '/?page=1&sort=name');
    createRouter(makeRoutes());
    expect(queryParams()).toEqual({ page: '1', sort: 'name' });
  });

  it('updates reactively when route changes', async () => {
    createRouter(makeRoutes());
    expect(queryParams()).toEqual({});

    await navigate('/about?foo=bar');
    expect(queryParams()).toEqual({ foo: 'bar' });
  });

  it('returns empty object when no route is matched', () => {
    window.history.replaceState(null, '', '/nonexistent');
    createRouter(makeRoutes());
    expect(currentRoute.peek()).toBeNull();
    expect(queryParams()).toEqual({});
  });
});

// ============================================================================
// getQueryParam
// ============================================================================

describe('getQueryParam', () => {
  it('returns the param value as a string', () => {
    window.history.replaceState(null, '', '/?page=2');
    createRouter(makeRoutes());
    const page = getQueryParam('page');
    expect(page()).toBe('2');
  });

  it('returns null when param does not exist', () => {
    window.history.replaceState(null, '', '/');
    createRouter(makeRoutes());
    const missing = getQueryParam('nope');
    expect(missing()).toBeNull();
  });
});

// ============================================================================
// setQueryParam
// ============================================================================

describe('setQueryParam', () => {
  it('updates the URL and triggers reactive update', async () => {
    createRouter(makeRoutes());
    expect(queryParams()).toEqual({});

    await setQueryParam('page', '3');
    expect(queryParams()).toEqual({ page: '3' });
  });

  it('removes the param when value is null', async () => {
    window.history.replaceState(null, '', '/?page=1&sort=name');
    createRouter(makeRoutes());
    expect(queryParams()).toEqual({ page: '1', sort: 'name' });

    await setQueryParam('page', null);
    expect(queryParams().page).toBeUndefined();
    expect(queryParams().sort).toBe('name');
  });
});

// ============================================================================
// setQueryParams
// ============================================================================

describe('setQueryParams', () => {
  it('sets multiple params at once', async () => {
    createRouter(makeRoutes());

    await setQueryParams({ page: '2', sort: 'name' });
    expect(queryParams()).toEqual({ page: '2', sort: 'name' });
  });

  it('can remove and set params in one call', async () => {
    window.history.replaceState(null, '', '/?page=1&sort=name');
    createRouter(makeRoutes());

    await setQueryParams({ page: null, sort: 'date', filter: 'active' });
    const params = queryParams();
    expect(params.page).toBeUndefined();
    expect(params.sort).toBe('date');
    expect(params.filter).toBe('active');
  });
});

// ============================================================================
// getRouteParam
// ============================================================================

describe('getRouteParam', () => {
  it('returns the matched route parameter', async () => {
    createRouter(makeRoutes());
    await navigate('/users/123');

    const userId = getRouteParam('id');
    expect(userId()).toBe('123');
  });

  it('returns null for non-existent params', async () => {
    createRouter(makeRoutes());
    await navigate('/users/123');

    const missing = getRouteParam('nope');
    expect(missing()).toBeNull();
  });
});
